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
import { CMS_HIDDEN, confPage, fwdPage, ISP_PASSWORD, KEY, SECRETS, userPage, USER_PASSWORD } from './sample';

vi.mock('../../../data/api', async () => (await import('../../../public/__tests__/mocks')).MOCK_API());
vi.mock('../../../data/uiapi', async () => (await import('../../../public/__tests__/mocks')).MOCK_UI());
vi.mock('../../../data/pages', async () => ({
  ...(await vi.importActual<object>('../../../data/pages')),
  fetchRoutes: vi.fn(), fetchStats: vi.fn(),
}));

type Hit = string | ((body: string) => string) | { status: number };
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
    [`/mail/api/v1/login?${KEY}`]: fixture('mail-api-login.json'),
    [`/Mail/API/v1/msgs?${KEY}`]: fixture('mail-api-msgs.json'),
    [`/Mail/API/v1/FwdQLen?${KEY}`]: '{"forwardqueuelength":[{"call": "RMS","queueLength": "0"}]}',
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
    return new Response(bytesOf(typeof hit === 'function' ? hit(body) : hit), { status: 200 });
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

test('Messages lists the API messages with held, sent and bounced from the list status fields', async () => {
  node();
  const { container } = open('messages');
  const list = await screen.findByRole('table', { name: 'Messages' });
  const rows = within(list).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(4);
  expect(rows[0]).toHaveTextContent('Housekeeping Results');
  expect(rows[2]).toHaveTextContent('uiapi test');
  expect(rows[2]).toHaveTextContent('Held');
  const tiles = screen.getByRole('region', { name: 'Message counts' });
  expect(within(tiles).getByText('Held').nextElementSibling).toHaveTextContent('1');
  expect(within(tiles).getByText('Sent').nextElementSibling).toHaveTextContent('0');
  const bounced = within(tiles).getByText('Bounced').nextElementSibling as HTMLElement;
  expect(bounced).toHaveTextContent('Unknown');
  expect(bounced.querySelector('.unknown')?.getAttribute('title')).toMatch(/no bounced status/i);
  expectNoOldPageLinks(container);
});

test('Messages counts forwarded (F) messages as sent', async () => {
  const msgs = fixture('mail-api-msgs.json').replace('"status": "N",\r\n"to": "SYSOP",\r\n"from": "SYSTEM",\r\n"size": "168"', '"status": "F",\r\n"to": "SYSOP",\r\n"from": "SYSTEM",\r\n"size": "168"');
  node({ [`/Mail/API/v1/msgs?${KEY}`]: msgs });
  open('messages');
  const tiles = await screen.findByRole('region', { name: 'Message counts' });
  await waitFor(() => expect(within(tiles).getByText('Sent').nextElementSibling).toHaveTextContent('1'));
});

test('a session the mail API does not treat as sysop shows its list, and every count is Unknown', async () => {
  node({ [`/Mail/API/v1/FwdQLen?${KEY}`]: { status: 403 }, [`/Mail/API/v1/msgs?${KEY}`]: fixture('mail-api-msgs-bulls.json') });
  open('messages');
  const tiles = await screen.findByRole('region', { name: 'Message counts' });
  await waitFor(() => expect(within(tiles).getByText('Held').nextElementSibling).toHaveTextContent('Unknown'));
  expect(within(tiles).getByText('Sent').nextElementSibling).toHaveTextContent('Unknown');
  expect(tiles.querySelector('.unknown')?.getAttribute('title')).toMatch(/not as sysop/i);
  expect(screen.getByRole('status')).toHaveTextContent(/only the messages a non-sysop/i);
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
  const select = lastIndex(calls.slice(0, save), (c) => c.url.startsWith('/Mail/'));
  expect(calls[select]).toMatchObject({ url: `/Mail/FwdDetails?${KEY}`, body: 'RMS' });
  expect(select).toBeGreaterThanOrEqual(0);
  expect(save).toBeGreaterThan(select);
  expect(calls[save]?.body).toBe(
    'RMS\n|||ATTACH 1\nNOFALLBACK\nC CMS\nELSE\nC 2 W6SAR-10\n||||true|1700|false|0|true|true|10000|false|true|false|true|false|120|',
  );
  expectNoOldPageLinks(container);
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
