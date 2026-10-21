process.env.TZ = 'America/Los_Angeles';

import { render, screen, within, fireEvent, waitFor } from '@testing-library/preact';
import { App } from '../../../app/App';
import { route, type Route } from '../../../app/router';
import { sysop } from '../../../data/session';
import { formPairs, parseForm } from '../../../data/forms';
import { bytesOf, fixture } from '../../../data/__tests__/helpers';
import { expectNoOldPageLinks, prime } from '../../../public/__tests__/prime';
import { NOW } from '../../../public/__tests__/sample';
import { paletteItems } from '../../palette';
import { resetMail } from '../drafts';
import { CMS_HIDDEN, confPage, fwdPage, ISP_PASSWORD, KEY, msgByBody, msgPage, SECRETS, userPage, USER_PASSWORD } from './sample';
import { setPicked } from '../drafts';

vi.mock('../../../data/api', async () => (await import('../../../public/__tests__/mocks')).MOCK_API());
vi.mock('../../../data/uiapi', async () => (await import('../../../public/__tests__/mocks')).MOCK_UI());
vi.mock('../../../data/pages', async () => ({
  ...(await vi.importActual<object>('../../../data/pages')),
  fetchRoutes: vi.fn(), fetchStats: vi.fn(),
}));

type Hit = string | ((body: string) => string | Promise<string>) | { status: number };
interface Call { url: string; method: string; body: string }

/** The node's pages and API for the shell and the mail screens; `over` replaces or adds routes. */
function node(over: Record<string, Hit> = {}): Call[] {
  const routes: Record<string, Hit> = {
    '/Mail/Header': fixture('mail-header.html'),
    [`/Mail/Status?${KEY}`]: fixture('mail-status.html'),
    [`/Mail/FwdList.txt?${KEY}`]: fixture('mail-fwdlist.txt'),
    [`/Mail/FwdDetails?${KEY}`]: (call) => fwdPage(call),
    [`/Mail/FWD?${KEY}`]: fixture('mail-fwd.html'),
    [`/Mail/Conf?${KEY}`]: confPage(),
    [`/Mail/Config?${KEY}`]: confPage(),
    [`/Mail/HK?${KEY}`]: fixture('mail-hk.html'),
    [`/Mail/Wel?${KEY}`]: fixture('mail-wel.html'),
    [`/Mail/Welcome?${KEY}`]: fixture('mail-wel.html'),
    [`/Mail/UserList.txt?${KEY}`]: fixture('mail-userlist.txt'),
    [`/Mail/UserDetails?${KEY}`]: (call) => userPage(call),
    [`/Mail/UserSave?${KEY}`]: () => userPage('RMS'),
    [`/Mail/FWDSave?${KEY}`]: () => fwdPage('RMS'),
    [`/Mail/FwdCommon?${KEY}`]: fixture('mail-fwd.html'),
    [`/Mail/WPInfo.txt?${KEY}`]: fixture('mail-wpinfo.txt'),
    [`/Mail/WPDetails?${KEY}`]: fixture('mail-wpdetails-n0call.html'),
    [`/Mail/WPSave?${KEY}`]: fixture('mail-wpdetails-n0call.html'),
    [`/Mail/MsgInfo.txt?${KEY}`]: fixture('mail-msginfo.txt'),
    [`/Mail/MsgDetails?${KEY}`]: msgByBody,
    ...over,
  };
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const raw = init?.body as Uint8Array | undefined;
    const body = raw ? Array.from(raw, (b) => String.fromCharCode(b)).join('') : '';
    calls.push({ url, method: init?.method ?? 'GET', body });
    const hit = routes[url];
    if (hit === undefined) return new Response('nope', { status: 404 });
    if (typeof hit === 'object') return new Response('', { status: hit.status });
    return new Response(bytesOf(typeof hit === 'function' ? await hit(body) : hit), { status: 200 });
  });
  return calls;
}

function lastIndex<T>(arr: T[], f: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (f(arr[i] as T)) return i;
  return -1;
}

const posts = (calls: Call[], path: string) => calls.filter((c) => c.method === 'POST' && c.url === `/Mail/${path}?${KEY}`);

let setItem: ReturnType<typeof vi.spyOn>;
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  prime();
  resetMail();
  setItem = vi.spyOn(Storage.prototype, 'setItem');
  for (const m of ['log', 'info', 'debug', 'warn', 'error'] as const) consoleSpies.push(vi.spyOn(console, m));
  sysop.value = 'in';
});
afterEach(() => {
  // Ruling: nothing goes to browser storage or the console.
  expect(setItem.mock.calls).toEqual([]);
  for (const s of consoleSpies) expect(s.mock.calls).toEqual([]);
  setItem.mockRestore();
  for (const s of consoleSpies.splice(0)) s.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sysop.value = 'unknown';
});

function open(r: Route) {
  location.hash = `#/${r}`;
  route.value = r;
  return render(<App />);
}

/** Ruling: a password the old page embeds is never in the DOM, as text, attribute or input value. */
function expectNoSecrets(root: Element) {
  for (const s of SECRETS) {
    expect(root.innerHTML).not.toContain(s);
    for (const el of Array.from(root.querySelectorAll('input, textarea, select'))) {
      expect((el as HTMLInputElement).value).not.toContain(s);
    }
  }
}

const saved = () => screen.findByText('Saved');

// ---------- Messages ----------

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const details = (calls: Call[]) => posts(calls, 'MsgDetails').map((c) => c.body);

test('Messages reads MsgInfo.txt then each MsgDetails in turn; held, sent and bounced come from the statuses', async () => {
  const calls = node();
  const { container } = open('messages');
  const list = await screen.findByRole('table', { name: 'Messages' });
  const rows = within(list).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(4);
  expect(rows[0]).toHaveTextContent('Housekeeping Results');
  expect(rows[2]).toHaveTextContent('uiapi test');
  expect(rows[2]).toHaveTextContent('Held');
  expect(rows[2]).toHaveTextContent('N0CALL');
  expect(posts(calls, 'MsgInfo.txt').map((c) => c.body)).toEqual(['||||']);
  expect(details(calls)).toEqual(['4', '3', '2', '1']);
  const tiles = screen.getByRole('region', { name: 'Message counts' });
  expect(within(tiles).getByText('Held').nextElementSibling).toHaveTextContent('1');
  expect(within(tiles).getByText('Sent').nextElementSibling).toHaveTextContent('0');
  const bounced = within(tiles).getByText('Bounced').nextElementSibling as HTMLElement;
  expect(bounced).toHaveTextContent('Unknown');
  expect(bounced.querySelector('.unknown')?.getAttribute('title')).toMatch(/no bounced status/i);
  expectNoOldPageLinks(container);
});

test('Messages counts forwarded (F) messages as sent', async () => {
  node({ [`/Mail/MsgDetails?${KEY}`]: (b) => (b === '4' ? msgPage(4, 'F', 'Out') : msgByBody(b)) });
  open('messages');
  const tiles = await screen.findByRole('region', { name: 'Message counts' });
  await waitFor(() => expect(within(tiles).getByText('Sent').nextElementSibling).toHaveTextContent('1'));
});

test('Messages loads one detail at a time with a progress line, and never polls; Refresh reads again', async () => {
  const gates = new Map<string, ReturnType<typeof deferred<string>>>();
  let hold = true;
  const calls = node({
    [`/Mail/MsgDetails?${KEY}`]: (b) => {
      if (!hold) return msgByBody(b);
      const g = deferred<string>();
      gates.set(b, g);
      return g.promise;
    },
  });
  open('messages');
  await waitFor(() => expect(details(calls)).toEqual(['4']));
  expect(screen.getByText('Reading message 1 of 4')).toBeInTheDocument();
  gates.get('4')!.resolve(msgByBody('4'));
  await waitFor(() => expect(details(calls)).toEqual(['4', '3']));
  expect(screen.getByText('Reading message 2 of 4')).toBeInTheDocument();
  for (const n of ['3', '2']) {
    gates.get(n)!.resolve(msgByBody(n));
    await waitFor(() => expect(details(calls)).toHaveLength(Number(5 - Number(n) + 1)));
  }
  gates.get('1')!.resolve(msgByBody('1'));
  await screen.findByRole('table', { name: 'Messages' });
  expect(posts(calls, 'MsgInfo.txt')).toHaveLength(1);
  hold = false;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(posts(calls, 'MsgInfo.txt')).toHaveLength(2));
  await waitFor(() => expect(details(calls)).toHaveLength(8));
});

test('a message deleted while reading (empty MsgDetails) is skipped and noted; the counts cover the rest', async () => {
  node({ [`/Mail/MsgDetails?${KEY}`]: (b) => (b === '2' ? '' : msgByBody(b)) });
  open('messages');
  const list = await screen.findByRole('table', { name: 'Messages' });
  expect(within(list).getAllByRole('row').slice(1)).toHaveLength(3);
  const tiles = screen.getByRole('region', { name: 'Message counts' });
  expect(within(tiles).getByText('Held').nextElementSibling).toHaveTextContent('0');
  expect(within(tiles).getByText('Sent').nextElementSibling).toHaveTextContent('0');
  expect(screen.getByText('1 message changed while reading')).toBeInTheDocument();
});

test('a MsgDetails request that fails makes every count Unknown with the reason', async () => {
  node({ [`/Mail/MsgDetails?${KEY}`]: (b) => (b === '2' ? Promise.reject(new Error('reset')) : msgByBody(b)) });
  open('messages');
  const tiles = await screen.findByRole('region', { name: 'Message counts' });
  await waitFor(() => expect(within(tiles).getByText('Held').nextElementSibling).toHaveTextContent('Unknown'));
  expect(within(tiles).getByText('Sent').nextElementSibling).toHaveTextContent('Unknown');
  expect(tiles.querySelector('.unknown')?.getAttribute('title')).toMatch(/reset/);
});

// ---------- Forwarding ----------

test('Forwarding lists the partners; the RMS interval saves through FwdDetails then FWDSave', async () => {
  const calls = node();
  const { container } = open('forwarding');
  fireEvent.click(await screen.findByRole('button', { name: 'RMS' }));
  const interval = await screen.findByLabelText('Interval (seconds)') as HTMLInputElement;
  await waitFor(() => expect(interval.value).toBe('1800'));
  expect(screen.getByRole('button', { name: 'AD6DM' })).toBeInTheDocument();
  fireEvent.input(interval, { target: { value: '1700' } });
  const form = screen.getByRole('region', { name: 'Forwarding for RMS' });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  await saved();
  const save = calls.findIndex((c) => c.url === `/Mail/FWDSave?${KEY}`);
  expect(save).toBeGreaterThan(0);
  // the last mail request before the save picked RMS
  const select = lastIndex(calls.slice(0, save), (c) => c.url.startsWith('/Mail/'));
  expect(select).toBeGreaterThanOrEqual(0);
  expect(calls[select]).toMatchObject({ url: `/Mail/FwdDetails?${KEY}`, body: 'RMS' });
  expect(calls[save]?.body).toBe(
    'RMS\n|||ATTACH 1\nNOFALLBACK\nC CMS\nELSE\nC 2 W6SAR-10\n||||true|1700|false|0|true|true|10000|false|true|false|true|false|120|',
  );
  expectNoOldPageLinks(container);
});

test.each([['a call no longer on the list', 'GONE'], ['a BBS user that is not a partner', 'N0CALL']])(
  'Forwarding never asks FwdDetails for %s (the node crashes on a non-partner)', async (_what, call) => {
    setPicked('forwarding', call);
    const calls = node();
    open('forwarding');
    await screen.findByRole('region', { name: 'Forwarding for AD6DM' });
    await waitFor(() => expect(posts(calls, 'FwdDetails').some((c) => c.body === 'AD6DM')).toBe(true));
    expect(posts(calls, 'FwdDetails').map((c) => c.body)).not.toContain(call);
  });

test('Forwarding makes no FwdDetails request until the partner list has loaded', async () => {
  setPicked('forwarding', 'RMS');
  const list = deferred<string>();
  const calls = node({ [`/Mail/FwdList.txt?${KEY}`]: () => list.promise });
  open('forwarding');
  await waitFor(() => expect(posts(calls, 'FwdList.txt').length).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 20));
  expect(posts(calls, 'FwdDetails')).toEqual([]);
  list.resolve(fixture('mail-fwdlist.txt'));
  await screen.findByRole('region', { name: 'Forwarding for RMS' });
});

test('the RMS forwarding palette entry opens the first partner when RMS is not one', async () => {
  const calls = node({ [`/Mail/FwdList.txt?${KEY}`]: 'AD6DM|' });
  open('health');
  paletteItems().find((i) => i.label === 'RMS forwarding')!.action!();
  route.value = 'forwarding';
  await screen.findByRole('region', { name: 'Forwarding for AD6DM' });
  expect(posts(calls, 'FwdDetails').map((c) => c.body)).not.toContain('RMS');
});

test('BBS users and White pages ignore a stale pick and open the first record', async () => {
  setPicked('bbsusers', 'GONE');
  setPicked('wp', 'GONE');
  const calls = node();
  const { unmount } = open('bbsusers');
  await screen.findByRole('region', { name: 'User AD6DM' });
  unmount();
  open('mailsettings');
  fireEvent.click(await screen.findByRole('tab', { name: 'White pages' }));
  await screen.findByRole('region', { name: 'White pages for N0CALL' });
  expect([...posts(calls, 'UserDetails'), ...posts(calls, 'WPDetails')].map((c) => c.body)).not.toContain('GONE');
});

test('Copy settings from offers the other partner after switching partners', async () => {
  node();
  open('forwarding');
  const copyFrom = async () => (await screen.findByLabelText('Copy settings from')) as HTMLSelectElement;
  await waitFor(async () => expect((await copyFrom()).value).toBe('RMS'));
  fireEvent.click(screen.getByRole('button', { name: 'RMS' }));
  await screen.findByRole('region', { name: 'Forwarding for RMS' });
  await waitFor(async () => expect((await copyFrom()).value).toBe('AD6DM'));
});

test('Forwarding shared settings post every field of the FwdCommon form', async () => {
  const calls = node();
  open('forwarding');
  const max = await screen.findByLabelText('Max size to send') as HTMLInputElement;
  await waitFor(() => expect(max.value).toBe('99999'));
  fireEvent.input(max, { target: { value: '50000' } });
  const form = screen.getByRole('region', { name: 'Shared forwarding settings' });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  await saved();
  const [post] = posts(calls, 'FwdCommon');
  const spec = parseForm(fixture('mail-fwd.html'));
  const expected = formPairs(spec, { MaxTX: '50000', Submit: 'Update' });
  expect(Array.from(new URLSearchParams(post!.body))).toEqual(expected);
});

// ---------- BBS users ----------

test('BBS users lists AD6DM and RMS from the user list; passwords never reach the DOM', async () => {
  node();
  const { container } = open('bbsusers');
  const list = await screen.findByRole('list', { name: 'BBS users' });
  await waitFor(() => expect(within(list).getByRole('button', { name: 'AD6DM' })).toBeInTheDocument());
  expect(within(list).getByRole('button', { name: 'RMS' })).toBeInTheDocument();
  fireEvent.click(within(list).getByRole('button', { name: 'RMS' }));
  const pw = await screen.findByLabelText('BBS password') as HTMLInputElement;
  const cms = screen.getByLabelText('CMS password') as HTMLInputElement;
  expect(pw.type).toBe('password');
  expect(cms.type).toBe('password');
  expect(pw.value).toBe('');
  expect(pw.hasAttribute('value')).toBe(false);
  expectNoSecrets(container);
  expectNoOldPageLinks(container);
});

test('BBS users: an untouched password posts unchanged, a typed one replaces it', async () => {
  const calls = node();
  const { container } = open('bbsusers');
  fireEvent.click(await screen.findByRole('button', { name: 'RMS' }));
  const name = await screen.findByLabelText('Name') as HTMLInputElement;
  fireEvent.input(name, { target: { value: 'Winlink' } });
  const form = screen.getByRole('region', { name: 'User RMS' });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  await saved();
  const [first] = posts(calls, 'UserSave');
  expect(first!.body.split('|').slice(21, 24)).toEqual(['Winlink', USER_PASSWORD, CMS_HIDDEN]);
  const before = calls.slice(0, calls.indexOf(first!)).filter((c) => c.url.startsWith('/Mail/'));
  expect(before.at(-1)).toMatchObject({ url: `/Mail/UserDetails?${KEY}`, body: 'RMS' });
  expectNoSecrets(container);

  fireEvent.input(screen.getByLabelText('BBS password'), { target: { value: 'typedNew5' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(posts(calls, 'UserSave')).toHaveLength(2));
  expect(posts(calls, 'UserSave')[1]!.body.split('|').slice(22, 24)).toEqual(['typedNew5', CMS_HIDDEN]);
  expectNoSecrets(container);
});

test('BBS users: a password box typed in and cleared again keeps the password', async () => {
  const calls = node();
  open('bbsusers');
  fireEvent.click(await screen.findByRole('button', { name: 'RMS' }));
  const pw = await screen.findByLabelText('BBS password') as HTMLInputElement;
  const form = screen.getByRole('region', { name: 'User RMS' });
  fireEvent.input(pw, { target: { value: 'x' } });
  fireEvent.input(pw, { target: { value: '' } });
  expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Winlink' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  await saved();
  expect(posts(calls, 'UserSave')[0]!.body.split('|').slice(21, 24)).toEqual(['Winlink', USER_PASSWORD, CMS_HIDDEN]);
});

test('a form changed on the node since it was opened is not posted', async () => {
  let reads = 0;
  const calls = node({ [`/Mail/Conf?${KEY}`]: () => (reads++ === 0 ? confPage() : confPage().replace('value="10" size="3" name="Streams"', 'value="10" size="3" name="Streams"').replace('<input value="0" size="3" name="UIInterval">', '<input value="15" size="3" name="UIInterval">')) });
  open('mailsettings');
  const streams = await screen.findByLabelText('Streams') as HTMLInputElement;
  await waitFor(() => expect(streams.value).toBe('10'));
  fireEvent.input(streams, { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Changed on the node since you opened it; reload to see it');
  expect(posts(calls, 'Config')).toEqual([]);
  // reload keeps the edit and shows the node's new value
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  await waitFor(() => expect((screen.getByLabelText('Send Mail For beacons every (minutes)') as HTMLInputElement).value).toBe('15'));
  expect((screen.getByLabelText('Streams') as HTMLInputElement).value).toBe('12');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await saved();
  expect(new URLSearchParams(posts(calls, 'Config')[0]!.body).get('UIInterval')).toBe('15');
});

test('a record changed on the node since it was opened is not posted', async () => {
  let reads = 0;
  const calls = node({ [`/Mail/UserDetails?${KEY}`]: (call) => (call === 'RMS' && reads++ > 0 ? userPage(call).replace('name="QTH" value=""', 'name="QTH" value="Elsewhere"') : userPage(call)) });
  open('bbsusers');
  fireEvent.click(await screen.findByRole('button', { name: 'RMS' }));
  const name = await screen.findByLabelText('Name') as HTMLInputElement;
  fireEvent.input(name, { target: { value: 'Winlink' } });
  fireEvent.click(within(screen.getByRole('region', { name: 'User RMS' })).getByRole('button', { name: 'Save' }));
  await screen.findByText('Changed on the node since you opened it; reload to see it');
  expect(posts(calls, 'UserSave')).toEqual([]);
});

test('Other settings draws a multiple select as one, and a disabled field read-only', async () => {
  const hk = fixture('mail-hk.html').replace('<input name="OvUnsent"',
    '<select name="Multi" multiple><option value="a" selected>A<option value="b">B</select><input name="Locked" value="7" disabled><input name="OvUnsent"');
  const calls = node({ [`/Mail/HK?${KEY}`]: hk });
  open('housekeeping');
  const multi = await screen.findByLabelText('Multi') as HTMLSelectElement;
  expect(multi.multiple).toBe(true);
  expect(Array.from(multi.selectedOptions).map((o) => o.value)).toEqual(['a']);
  expect(screen.getByLabelText('Locked')).toHaveAttribute('readonly');
  for (const o of Array.from(multi.options)) o.selected = true;
  fireEvent.change(multi);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await saved();
  const sent = new URLSearchParams(posts(calls, 'HK')[0]!.body);
  expect(sent.getAll('Multi')).toEqual(['a', 'b']);
  expect(sent.has('Locked')).toBe(false);
});

// ---------- Housekeeping ----------

test('Housekeeping saves every field of the old form, overrides with CRLF, and shows Saved', async () => {
  const calls = node();
  const { container } = open('housekeeping');
  const bid = await screen.findByLabelText('BID lifetime (days)') as HTMLInputElement;
  await waitFor(() => expect(bid.value).toBe('60'));
  fireEvent.input(bid, { target: { value: '45' } });
  fireEvent.input(screen.getByLabelText('From overrides'), { target: { value: 'ALL, 10\nGB7BPQ, 5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await saved();
  const [post] = posts(calls, 'HK');
  const spec = parseForm(fixture('mail-hk.html'));
  expect(Array.from(new URLSearchParams(post!.body))).toEqual(
    formPairs(spec, { BIDLife: '45', From: 'ALL, 10\nGB7BPQ, 5', Save: 'Save' }),
  );
  expect(post!.body).toContain('From=ALL%2C+10%0D%0AGB7BPQ%2C+5');
  expect(post!.body).not.toContain('RunNow');
  expectNoOldPageLinks(container);
});

// ---------- Mail settings ----------

test('Mail settings: Configuration is grouped, posts every field, and keeps the ISP password out of the DOM', async () => {
  const calls = node();
  const { container } = open('mailsettings');
  const streams = await screen.findByLabelText('Streams') as HTMLInputElement;
  await waitFor(() => expect(streams.value).toBe('10'));
  expect(screen.getByRole('region', { name: 'ISP gateway' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'FBB reject.sys filters' })).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toHaveProperty('type', 'password');
  expectNoSecrets(container);
  fireEvent.input(streams, { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await saved();
  const [post] = posts(calls, 'Config');
  const spec = parseForm(confPage());
  expect(Array.from(new URLSearchParams(post!.body))).toEqual(formPairs(spec, { Streams: '12', Save: 'Save' }));
  expect(new URLSearchParams(post!.body).get('ISPPassword')).toBe(ISP_PASSWORD);
  expectNoSecrets(container);
  expectNoOldPageLinks(container);
});

test('Mail settings: Welcome posts the seven texts with CRLF line breaks', async () => {
  const calls = node();
  open('mailsettings');
  fireEvent.click(await screen.findByRole('tab', { name: 'Welcome & prompts' }));
  const bye = await screen.findByLabelText('Sign-off message') as HTMLTextAreaElement;
  fireEvent.input(bye, { target: { value: '73 de AD6DM' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await saved();
  const [post] = posts(calls, 'Welcome');
  const sent = new URLSearchParams(post!.body);
  expect(Array.from(sent.keys())).toEqual(['NUWelcome', 'NewWelcome', 'ExWelcome', 'NUPrompt', 'NewPrompt', 'ExPrompt', 'Bye', 'Save']);
  expect(sent.get('Bye')).toBe('73 de AD6DM');
  expect(sent.get('NUPrompt')).toBe('de AD6DM>\r\n');
});

test('Mail settings: White pages lists N0CALL and saves Name|Home1|...|ZIP2| after selecting it', async () => {
  const calls = node();
  open('mailsettings');
  fireEvent.click(await screen.findByRole('tab', { name: 'White pages' }));
  fireEvent.click(await screen.findByRole('button', { name: 'N0CALL' }));
  const name = await screen.findByLabelText('Name') as HTMLInputElement;
  await waitFor(() => expect(name.value).toBe('B'));
  fireEvent.input(name, { target: { value: 'Bob' } });
  fireEvent.input(screen.getByLabelText('QTH 1'), { target: { value: 'Sacramento' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await saved();
  const [post] = posts(calls, 'WPSave');
  expect(post!.body).toBe('Bob|||Sacramento||||');
  const before = calls.slice(0, calls.indexOf(post!)).filter((c) => c.url.startsWith('/Mail/'));
  expect(before.at(-1)).toMatchObject({ url: `/Mail/WPDetails?${KEY}`, body: 'N0CALL' });
});

// ---------- Mail actions (fixtures from scripts/capture-mail-actions.sh) ----------

/** The staging MsgSave replies: a body ending |N| releases message 2, |K| kills it, |H| holds it. */
function msgSave(body: string): string {
  const [n] = body.split('|').slice(2, 3).map((bid) => bid.split('_')[0]);
  const status = body.split('|')[7] as string;
  const base = status === 'N' ? fixture('mail-msgsave-2-released.html') : fixture('mail-msgsave-2-held.html');
  const page = status === 'K'
    ? base.replace('<option selected value=H>', '<option  value=H>').replace('<option  value=K>', '<option selected value=K>')
    : base;
  return page.replace('<h4>Message 2</h4>', `<h4>Message ${n}</h4>`);
}

const panel = () => screen.findByRole('region', { name: 'Message 2' });

test('Messages: opening a message shows every field the node reports, and its forwarding table', async () => {
  node();
  const { container } = open('messages');
  fireEvent.click(await screen.findByRole('button', { name: 'Open message 2' }));
  const p = await panel();
  await within(p).findByText('uiapi test');
  for (const [k, v] of [['From', 'N0CALL'], ['To', 'SYSOP'], ['BID', '2_AD6DM'], ['Type', 'P (Personal)'], ['Status', 'H (Held)'],
    ['Received', '20-Oct 23:52Z'], ['Size', '7 bytes'], ['Attachments', 'None']] as const) {
    expect(within(p).getByText(k).nextElementSibling).toHaveTextContent(v);
  }
  const fwd = within(p).getByRole('table');
  expect(fwd).toHaveTextContent('AD6DM');
  expect(fwd).toHaveTextContent('Not for this partner');
  expect(within(p).getByRole('button', { name: 'Release' })).toBeEnabled();
  expect(within(p).queryByRole('button', { name: 'Hold' })).toBeNull();
  expectNoOldPageLinks(container);
});

test('Messages: Release posts MsgSave with status N after a fresh MsgDetails, and shows the node reply', async () => {
  const calls = node({ [`/Mail/MsgSave?${KEY}`]: msgSave });
  open('messages');
  fireEvent.click(await screen.findByRole('button', { name: 'Open message 2' }));
  const p = await panel();
  fireEvent.click(await within(p).findByRole('button', { name: 'Release' }));
  await within(p).findByText('Released. The node now shows status N (New).');
  const save = posts(calls, 'MsgSave');
  expect(save.map((c) => c.body)).toEqual(['N0CALL|SYSOP|2_AD6DM|||uiapi test|P|N|']);
  const i = calls.indexOf(save[0]!);
  expect(calls[i - 1]).toMatchObject({ url: `/Mail/MsgDetails?${KEY}`, body: '2' });
  expect(within(p).getByText('Status').nextElementSibling).toHaveTextContent('N (New)');
  // The list row follows the node's reply.
  const row = within(screen.getByRole('table', { name: 'Messages' })).getByRole('button', { name: 'Open message 2' }).closest('tr')!;
  expect(row).toHaveTextContent('New');
  expect(within(p).getByRole('button', { name: 'Hold' })).toBeInTheDocument();
});

test('Messages: Kill asks in the page first; Keep sends nothing, Yes sends one MsgSave with status K', async () => {
  const calls = node({ [`/Mail/MsgSave?${KEY}`]: msgSave });
  const confirm = vi.spyOn(window, 'confirm');
  open('messages');
  fireEvent.click(await screen.findByRole('button', { name: 'Open message 2' }));
  const p = await panel();
  fireEvent.click(await within(p).findByRole('button', { name: 'Kill' }));
  expect(within(p).getByText(/Kill message 2\?/)).toBeInTheDocument();
  fireEvent.click(within(p).getByRole('button', { name: 'Keep' }));
  expect(posts(calls, 'MsgSave')).toEqual([]);
  fireEvent.click(within(p).getByRole('button', { name: 'Kill' }));
  fireEvent.click(within(p).getByRole('button', { name: 'Yes, kill' }));
  await within(p).findByText('Killed. The node now shows status K (Killed).');
  expect(posts(calls, 'MsgSave').map((c) => c.body)).toEqual(['N0CALL|SYSOP|2_AD6DM|||uiapi test|P|K|']);
  expect(within(p).queryByRole('button', { name: 'Kill' })).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
  confirm.mockRestore();
});

test('Messages: a kill whose reply was the sign-in page is not sent again after sign-in', async () => {
  let expired = false;
  const signon = '<html><body><form method=post action=/Mail/Signon?Mail>Sign in</form></body></html>';
  const calls = node({
    '/Mail/Header': () => (expired ? signon : fixture('mail-header.html')),
    [`/Mail/MsgSave?${KEY}`]: () => { expired = true; return signon; },
    '/Node/Signon?Node': () => { expired = false; return fixture('node-signon.html'); },
  });
  open('messages');
  fireEvent.click(await screen.findByRole('button', { name: 'Open message 2' }));
  const p = await panel();
  fireEvent.click(await within(p).findByRole('button', { name: 'Kill' }));
  fireEvent.click(within(p).getByRole('button', { name: 'Yes, kill' }));
  // The shell gives way to the sign-in screen.
  const user = await screen.findByLabelText(/user/i);
  fireEvent.input(user, { target: { value: 'sysop' } });
  fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'staging' } });
  fireEvent.submit(user.closest('form')!);
  // Back on Messages with the message open: the node's state, read again, and why nothing was resent.
  await screen.findByText('The sign-in ran out as the kill was sent, so it was not sent again. The node now shows status H (Held).');
  expect((await within(await panel()).findByText('Status')).nextElementSibling).toHaveTextContent('H (Held)');
  expect(posts(calls, 'MsgSave')).toHaveLength(1);
});

test('Messages: Show text reads the message file through EditM after picking the message', async () => {
  const calls = node({ [`/Mail/EditM?${KEY}?2`]: fixture('mail-editm-2.html') });
  open('messages');
  fireEvent.click(await screen.findByRole('button', { name: 'Open message 2' }));
  const p = await panel();
  fireEvent.click(await within(p).findByRole('button', { name: 'Show text' }));
  expect(await within(p).findByLabelText('Text of message 2')).toHaveTextContent('hello');
  const i = calls.findIndex((c) => c.url === `/Mail/EditM?${KEY}?2`);
  expect(calls[i - 1]).toMatchObject({ url: `/Mail/MsgDetails?${KEY}`, body: '2' });
});

test('Messages: Edit fields posts every field with the edits, and a "|" is refused before anything is sent', async () => {
  const calls = node({ [`/Mail/MsgSave?${KEY}`]: () => fixture('mail-msgsave-2-held.html').replace('value="uiapi test"', 'value="new title"') });
  open('messages');
  fireEvent.click(await screen.findByRole('button', { name: 'Open message 2' }));
  const p = await panel();
  fireEvent.click(await within(p).findByRole('button', { name: 'Edit fields' }));
  fireEvent.input(within(p).getByLabelText('Title'), { target: { value: 'a|b' } });
  fireEvent.click(within(p).getByRole('button', { name: 'Save fields' }));
  await within(p).findByText(/Title cannot hold "\|"/);
  expect(posts(calls, 'MsgSave')).toEqual([]);
  fireEvent.input(within(p).getByLabelText('Title'), { target: { value: 'new title' } });
  fireEvent.input(within(p).getByLabelText('To'), { target: { value: 'AD6DM' } });
  fireEvent.click(within(p).getByRole('button', { name: 'Save fields' }));
  await within(p).findByText('Saved. The node now shows status H (Held).');
  expect(posts(calls, 'MsgSave').map((c) => c.body)).toEqual(['N0CALL|AD6DM|2_AD6DM|||new title|P|H|']);
});

test('Messages: a forwarding step goes to MsgFwdUpdate for that partner and shows the cell as the node now has it', async () => {
  const calls = node({ [`/Mail/Msgs?${KEY}`]: 'msgs page', [`/Mail/MsgFwdUpdate?${KEY}`]: () => fixture('mail-msgfwdupdate-4-queued.html').replace('Message 4', 'Message 2') });
  open('messages');
  fireEvent.click(await screen.findByRole('button', { name: 'Open message 2' }));
  const p = await panel();
  fireEvent.click(await within(p).findByRole('button', { name: 'Queue for RMS' }));
  await within(p).findByText('RMS: the node now shows queued.');
  expect(posts(calls, 'MsgFwdUpdate').map((c) => c.body)).toEqual(['2']);
  expect(within(p).getByRole('button', { name: 'Mark sent to RMS' })).toBeInTheDocument();
});

test('Forwarding: Start forwarding checks the partner list, picks the partner, sends StartForward and shows the reply', async () => {
  const calls = node({ [`/Mail/FWDSave?${KEY}`]: (b) => (b === 'StartForward' ? fixture('mail-fwdsave-startforward-rms.html') : fwdPage('RMS')) });
  setPicked('forwarding', 'RMS');
  open('forwarding');
  fireEvent.click(await screen.findByRole('button', { name: 'Start forwarding' }));
  await screen.findByText(/Start Forwarding sent at .*The node answered with RMS's record: 0 messages queued\./);
  const start = posts(calls, 'FWDSave').filter((c) => c.body === 'StartForward');
  expect(start).toHaveLength(1);
  const before = calls.slice(0, calls.indexOf(start[0]!)).filter((c) => c.method === 'POST');
  expect(before.slice(-2).map((c) => `${c.url.split('?')[0]} ${c.body}`)).toEqual(['/Mail/FwdList.txt ', '/Mail/FwdDetails RMS']);
});

test('White pages: Delete record asks in the page first, then deletes and shows the list the node now has', async () => {
  let deleted = false;
  const calls = node({
    [`/Mail/WPInfo.txt?${KEY}`]: () => (deleted ? 'N0CALL|</body></html>' : 'N0CALL|N1TEST|</body></html>'),
    [`/Mail/WPDetails?${KEY}`]: (b) => fixture('mail-wpdetails-n0call.html').replace('value="N0CALL"', `value="${b}"`),
    [`/Mail/WPSave?${KEY}`]: () => { deleted = true; return fixture('mail-wpdetails-n0call.html'); },
  });
  open('mailsettings');
  fireEvent.click(await screen.findByRole('tab', { name: 'White pages' }));
  fireEvent.click(await screen.findByRole('button', { name: 'N1TEST' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete record' }));
  expect(screen.getByText('Delete N1TEST from the white pages?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
  expect(posts(calls, 'WPSave')).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, delete record' }));
  await screen.findByText("Deleted: the node's list no longer holds N1TEST.");
  expect(posts(calls, 'WPSave').map((c) => c.body)).toEqual(['Delete']);
  expect(screen.queryByRole('button', { name: 'N1TEST' })).toBeNull();
});

test('White pages: the only record is not deleted, with the reason', async () => {
  const calls = node();
  open('mailsettings');
  fireEvent.click(await screen.findByRole('tab', { name: 'White pages' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete record' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, delete record' }));
  await screen.findByText(/N0CALL is the only white pages record/);
  expect(posts(calls, 'WPSave')).toEqual([]);
});

// ---------- Shell ----------

test('the mail screens are routed, not Coming soon, and register palette entries', async () => {
  node();
  for (const r of ['messages', 'forwarding', 'bbsusers', 'housekeeping', 'mailsettings'] as const) {
    const { unmount } = open(r);
    expect(screen.queryByText('Coming in this release.')).toBeNull();
    unmount();
  }
  open('health');
  const labels = paletteItems().map((i) => i.label);
  expect(labels).toEqual(expect.arrayContaining(['Mail configuration', 'Welcome messages and prompts', 'White pages', 'RMS forwarding']));
});
