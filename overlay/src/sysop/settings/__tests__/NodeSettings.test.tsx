process.env.TZ = 'America/Los_Angeles';

import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/preact';
import { App } from '../../../app/App';
import { route } from '../../../app/router';
import { sysop } from '../../../data/session';
import { CFG_SAVE_LIMIT, encodeCfgSave } from '../../../data/forms';
import { parseMailKey } from '../../../data/pages';
import { fixture, stubFetch } from '../../../data/__tests__/helpers';
import { expectNoOldPageLinks, prime } from '../../../public/__tests__/prime';
import { NOW } from '../../../public/__tests__/sample';
import { paletteItems } from '../../palette';
import { changeSummary, lineDiff } from '../cfgdiff';
import { cfgDraft, editDraft, resetSettings } from '../draft';
import { CMS_PASSWORD, editPage, SAMPLE_CFG, SAVED_REPLY, USER_PASSWORD } from './sample';

vi.mock('../../../data/api', async () => (await import('../../../public/__tests__/mocks')).MOCK_API());
vi.mock('../../../data/uiapi', async () => (await import('../../../public/__tests__/mocks')).MOCK_UI());
vi.mock('../../../data/pages', async () => ({
  ...(await vi.importActual<object>('../../../data/pages')),
  fetchRoutes: vi.fn(), fetchStats: vi.fn(),
}));

const KEY = parseMailKey(fixture('mail-header.html'));
const NOT_AUTH = fixture('node-not-authorized.html');

/** Node pages for the shell plus the Edit Config page; `over` replaces or adds routes. */
function nodePages(over: Record<string, string | ((init?: RequestInit) => string)> = {}) {
  return stubFetch({
    '/Mail/Header': fixture('mail-header.html'),
    [`/Mail/Status?${KEY}`]: fixture('mail-status.html'),
    [`/Mail/FwdList.txt?${KEY}`]: fixture('mail-fwdlist.txt'),
    [`/Mail/FwdDetails?${KEY}`]: fixture('mail-fwddetails-rms.html'),
    '/Node/EditCfg.html': editPage(SAMPLE_CFG),
    '/Node/CFGSave?N1': SAVED_REPLY,
    ...over,
  });
}

/** The node's decoder (HTTPcode.c SaveConfigFile): after "Msg=", uppercase %XX, + is space, CR dropped, up to &Save=. */
function nodeSaveDecode(body: Uint8Array): string {
  let s = '';
  for (const b of body) s += String.fromCharCode(b);
  const msg = s.slice('Msg='.length, s.indexOf('&Save='));
  let out = '';
  for (let i = 0; i < msg.length; i++) {
    let c = msg.charCodeAt(i);
    if (c === 0x25) {
      let m = msg.charCodeAt(++i) - 48; if (m > 9) m -= 7;
      let n = msg.charCodeAt(++i) - 48; if (n > 9) n -= 7;
      c = m * 16 + n;
    } else if (c === 0x2b) c = 0x20;
    if (c !== 13) out += String.fromCharCode(c);
  }
  return out;
}

let setItem: ReturnType<typeof vi.spyOn>;
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  prime();
  resetSettings();
  setItem = vi.spyOn(Storage.prototype, 'setItem');
  for (const m of ['log', 'info', 'debug', 'warn', 'error'] as const) consoleSpies.push(vi.spyOn(console, m));
  sysop.value = 'in';
  location.hash = '#/settings';
  route.value = 'settings';
});
afterEach(() => {
  // Ruling: the config (USER passwords, CMSPASS) never reaches browser storage or the console.
  const leaked = (args: unknown[]) => args.some((a) => /NODECALL|CMSPASS|USER=|hunter2x|cmsSecret9/.test(String(a)));
  expect(setItem.mock.calls.filter(leaked)).toEqual([]);
  for (const s of consoleSpies) expect(s.mock.calls.filter(leaked)).toEqual([]);
  setItem.mockRestore();
  for (const s of consoleSpies.splice(0)) s.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sysop.value = 'unknown';
});

const editor = () => screen.findByRole('textbox', { name: 'bpq32.cfg' }) as Promise<HTMLTextAreaElement>;
const type = (el: HTMLTextAreaElement, value: string) => fireEvent.input(el, { target: { value } });
const saveButton = () => screen.getByRole('button', { name: 'Save' });

test('encodeCfgSave round-trips "a+b%c&d=e\\tf °\\n" through the node decoder; the body ends &Save=Save', () => {
  const text = 'a+b%c&d=e\tf °\n';
  const body = encodeCfgSave(text);
  expect(nodeSaveDecode(body)).toBe(text);
  let s = '';
  for (const b of body) s += String.fromCharCode(b);
  expect(s.startsWith('Msg=')).toBe(true);
  expect(s.endsWith('&Save=Save')).toBe(true);
});

test('Settings loads bpq32.cfg into the editor, full text, from the Edit Config page', async () => {
  nodePages();
  const { container } = render(<App />);
  const ta = await editor();
  expect(ta.value).toBe(SAMPLE_CFG);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
  expect(screen.getByText('No changes')).toBeInTheDocument();
  expect(saveButton()).toBeDisabled();
  expect(container.querySelector('footer.foot')).toHaveTextContent('BarBPQ - LinBPQ Web UI');
  expectNoOldPageLinks(container);
});

test('the editor highlights keywords, comments and PORT blocks, and marks changed lines', async () => {
  nodePages();
  const { container } = render(<App />);
  const ta = await editor();
  const hl = container.querySelector('.cfg-hl') as HTMLElement;
  expect(hl.querySelector('.tk-comment')).toHaveTextContent('; Basic RMS configuration');
  expect(Array.from(hl.querySelectorAll('.tk-port')).map((e) => e.textContent)).toEqual(['PORT', 'PORT', 'PORT']);
  expect(hl.querySelector('.tk-key')).toHaveTextContent('SIMPLE');
  type(ta, SAMPLE_CFG.replace('IDINTERVAL=15', 'IDINTERVAL=20'));
  await screen.findByText('1 line changed');
  const changed = container.querySelectorAll('.cfg-hl .ln.chg');
  expect(changed).toHaveLength(1);
  expect(changed[0]).toHaveTextContent('IDINTERVAL=20');
  const diff = screen.getByRole('region', { name: 'Changes' });
  expect(within(diff).getByText('IDINTERVAL=15')).toBeInTheDocument();
  expect(within(diff).getByText('IDINTERVAL=20')).toBeInTheDocument();
  expect(saveButton()).toBeEnabled();
});

test('check errors list the line, block the save, and a warning does not', async () => {
  nodePages();
  render(<App />);
  const ta = await editor();
  type(ta, SAMPLE_CFG.replace(' TCPPORT=18001\nENDPORT', ' TCPPORT=18001').replace('IDINTERVAL=15', 'IDINTERVAL=15\nFROBNICATE=1'));
  const list = await screen.findByRole('list', { name: 'Config check' });
  expect(list).toHaveTextContent('Line 40');
  expect(list).toHaveTextContent('PORT block has no ENDPORT');
  expect(list).toHaveTextContent('Unknown keyword "FROBNICATE"');
  expect(saveButton()).toBeDisabled();
  type(ta, SAMPLE_CFG.replace('IDINTERVAL=15', 'IDINTERVAL=15\nFROBNICATE=1'));
  await waitFor(() => expect(saveButton()).toBeEnabled());
  type(ta, `${SAMPLE_CFG}; price €\n`);
  await waitFor(() => expect(screen.getByRole('list', { name: 'Config check' })).toHaveTextContent('cannot be sent to the node'));
  expect(saveButton()).toBeDisabled();
});

test('a config over the limit is refused in the UI with its size, and no save request is made', async () => {
  const calls = nodePages();
  render(<App />);
  const ta = await editor();
  const pad = '\n'.repeat(Math.ceil((CFG_SAVE_LIMIT - encodeCfgSave(SAMPLE_CFG).length) / 3) + 1);
  const big = SAMPLE_CFG + pad;
  const n = encodeCfgSave(big).length;
  expect(n).toBeGreaterThan(CFG_SAVE_LIMIT);
  type(ta, big);
  await screen.findByText(`Config too large to save through the node (${n.toLocaleString('en-US')} bytes, limit 99,000)`);
  expect(saveButton()).toBeDisabled();
  fireEvent.click(saveButton());
  expect(calls.filter((c) => c.url.includes('CFGSave'))).toEqual([]);
});

test('Save posts the draft, the banner reads "Saved. Restart linbpq to apply." and no restart is requested', async () => {
  let posted: Uint8Array | undefined;
  const calls = nodePages({ '/Node/CFGSave?N1': (init) => { posted = init?.body as Uint8Array; return SAVED_REPLY; } });
  render(<App />);
  const ta = await editor();
  const edited = SAMPLE_CFG.replace('TXTAIL=50', 'TXTAIL=110');
  type(ta, edited);
  fireEvent.click(saveButton());
  const banner = await screen.findByRole('status', { name: 'Restart needed' });
  expect(banner).toHaveTextContent('Saved. Restart linbpq to apply.');
  expect(nodeSaveDecode(posted!)).toBe(edited);
  expect(screen.getByText('No changes')).toBeInTheDocument();
  const urls = calls.map((c) => c.url);
  expect(urls.filter((u) => /restart|shutdown|reboot|close/i.test(u))).toEqual([]);
  expect(urls.filter((u) => u.startsWith('/Node/'))).toEqual(['/Node/EditCfg.html', '/Node/EditCfg.html', '/Node/CFGSave?N1']);
  expect(within(banner).queryByRole('button')).toBeNull();
});

const folds = () => screen.getByRole('group', { name: 'Fold sections' });

test('folding a PORT block, editing elsewhere and saving posts the same bytes as editing the unfolded file', async () => {
  let posted: Uint8Array | undefined;
  nodePages({ '/Node/CFGSave?N1': (init) => { posted = init?.body as Uint8Array; return SAVED_REPLY; } });
  render(<App />);
  await editor();
  expect(within(folds()).getAllByRole('button', { pressed: false }).map((b) => b.textContent))
    .toEqual(['IDMSG:', 'PORT 1 · Telnet Server', 'PORT 3 · VARA FM', 'PORT 2 · Direwolf']);
  fireEvent.click(within(folds()).getByRole('button', { name: 'PORT 1 · Telnet Server' }));
  // The block is one row; its lines, USER passwords included, are in no text box.
  expect(screen.getByRole('button', { name: /PORT 1 · Telnet Server.*12 lines folded, 18 to 29/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('textbox', { name: 'bpq32.cfg' })).toBeNull();
  const boxes = screen.getAllByRole('textbox', { name: /^bpq32\.cfg lines/ }) as HTMLTextAreaElement[];
  expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual(['bpq32.cfg lines 1 to 17', 'bpq32.cfg lines 30 to 52']);
  expect(boxes.some((b) => b.value.includes('CMSPASS'))).toBe(false);
  type(boxes[0]!, boxes[0]!.value.replace('IDINTERVAL=15', 'IDINTERVAL=20'));
  await screen.findByText('1 line changed');
  // Still folded after the edit; the second piece picks up its own edit too.
  const after = screen.getAllByRole('textbox', { name: /^bpq32\.cfg lines/ }) as HTMLTextAreaElement[];
  type(after[1]!, after[1]!.value.replace('TXTAIL=50', 'TXTAIL=110'));
  await screen.findByText('2 lines changed');
  fireEvent.click(saveButton());
  await screen.findByRole('status', { name: 'Restart needed' });
  const expected = SAMPLE_CFG.replace('IDINTERVAL=15', 'IDINTERVAL=20').replace('TXTAIL=50', 'TXTAIL=110');
  expect(nodeSaveDecode(posted!)).toBe(expected);
  expect(Array.from(posted!)).toEqual(Array.from(encodeCfgSave(expected)));
  expect(setItem.mock.calls.filter((c: unknown[]) => /port:|fold/i.test(String(c)))).toEqual([]);
});

test('a folded file that is saved untouched round-trips byte for byte; Unfold all brings the single editor back', async () => {
  // The textarea the node serves holds LF line ends (the node drops CR on save anyway).
  const cfg = SAMPLE_CFG.replace('IDINTERVAL=15', 'IDINTERVAL=15\t; 20° east +a%b&c=d');
  nodePages({ '/Node/EditCfg.html': editPage(cfg) });
  render(<App />);
  const ta = await editor();
  expect(ta.value).toBe(cfg);
  fireEvent.click(screen.getByRole('button', { name: 'Fold all ports' }));
  const boxes = screen.getAllByRole('textbox', { name: /^bpq32\.cfg lines/ }) as HTMLTextAreaElement[];
  expect(boxes.map((b) => b.getAttribute('aria-label')))
    .toEqual(['bpq32.cfg lines 1 to 17', 'bpq32.cfg lines 30 to 30', 'bpq32.cfg lines 38 to 38', 'bpq32.cfg lines 49 to 52']);
  // Re-typing each piece as it is changes nothing.
  for (const b of boxes) type(b, b.value);
  expect(cfgDraft.value).toBe(cfg);
  expect(screen.getByText('No changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Unfold all' }));
  expect((await editor()).value).toBe(cfg);
});

test('jumping to a check result inside a folded block unfolds it', async () => {
  nodePages();
  render(<App />);
  const ta = await editor();
  type(ta, SAMPLE_CFG.replace(' DRIVER=VARA', ' DRIVER=VARA\n FROBNICATE=1'));
  const list = await screen.findByRole('list', { name: 'Config check' });
  fireEvent.click(within(folds()).getByRole('button', { name: 'PORT 3 · VARA FM' }));
  expect(screen.getByRole('button', { name: /PORT 3 · VARA FM.*has a warning/ })).toBeInTheDocument();
  fireEvent.click(within(list).getByRole('button', { name: 'Line 35' }));
  await waitFor(() => expect(within(folds()).getByRole('button', { name: 'PORT 3 · VARA FM' })).toHaveAttribute('aria-pressed', 'false'));
  expect(screen.getByRole('textbox', { name: 'bpq32.cfg' })).toHaveFocus();
});

test('a session that expires during the save keeps the draft, asks for sign-in, then saves it', async () => {
  let expired = false;
  let posted: Uint8Array | undefined;
  nodePages({
    '/Node/EditCfg.html': () => (expired ? NOT_AUTH : editPage(SAMPLE_CFG)),
    '/Node/CFGSave?N1': (init) => { posted = init?.body as Uint8Array; return SAVED_REPLY; },
    '/Node/Signon?Node': () => { expired = false; return fixture('node-signon.html'); },
  });
  render(<App />);
  const ta = await editor();
  const edited = SAMPLE_CFG.replace('IDINTERVAL=15', 'IDINTERVAL=30');
  type(ta, edited);
  expired = true;
  fireEvent.click(saveButton());
  // The shell gives way to the sign-in screen; the draft stays in memory.
  const user = await screen.findByLabelText(/user/i);
  expect(cfgDraft.value).toBe(edited);
  expect(posted).toBeUndefined();
  fireEvent.input(user, { target: { value: 'sysop' } });
  fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'staging' } });
  fireEvent.submit(user.closest('form')!);
  const banner = await screen.findByRole('status', { name: 'Restart needed' });
  expect(banner).toHaveTextContent('Saved. Restart linbpq to apply.');
  expect(nodeSaveDecode(posted!)).toBe(edited);
  expect((await editor()).value).toBe(edited);
});

test('a failed save keeps the draft and shows the node\'s reason', async () => {
  nodePages({ '/Node/CFGSave?N1': '<html><script>alert("Failed to write Config File");window.close();</script></html>' });
  render(<App />);
  const ta = await editor();
  type(ta, `${SAMPLE_CFG}; x\n`);
  fireEvent.click(saveButton());
  await screen.findByText(/Config save failed: Failed to write Config File/);
  expect(ta.value).toBe(`${SAMPLE_CFG}; x\n`);
  expect(screen.queryByRole('status', { name: 'Restart needed' })).toBeNull();
});

test('a failed load shows the reason, never a guessed config', async () => {
  nodePages({ '/Node/EditCfg.html': '<html><body>no textarea here</body></html>' });
  render(<App />);
  await screen.findByText(/Could not read config text from Edit Config/);
  expect(screen.queryByRole('textbox', { name: 'bpq32.cfg' })).toBeNull();
});

test('Ports form: TXTAIL for port 2 set to 110 changes only that line of the draft', async () => {
  nodePages();
  render(<App />);
  await editor();
  fireEvent.click(screen.getByRole('tab', { name: 'Ports' }));
  const input = screen.getByLabelText('TXTAIL for port 2 (ms)') as HTMLInputElement;
  expect(input.value).toBe('50');
  expect(screen.getByLabelText('TXTAIL for port 3 (ms)')).toHaveValue(null);
  fireEvent.input(input, { target: { value: '110' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply TXTAIL for port 2' }));
  expect(cfgDraft.value).toBe(SAMPLE_CFG.replace(' TXTAIL=50 ; tail', ' TXTAIL=110 ; tail'));
  expect(screen.getByText('1 line changed')).toBeInTheDocument();
});

test('Applications form edits one APPLICATION line and adds a new one', async () => {
  nodePages();
  render(<App />);
  await editor();
  fireEvent.click(screen.getByRole('tab', { name: 'Applications' }));
  fireEvent.input(screen.getByLabelText('Call for application 2'), { target: { value: 'AD6DM-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply application 2' }));
  expect(cfgDraft.value).toContain('\nAPPLICATION 2,BBS,,AD6DM-1\n');
  fireEvent.input(screen.getByLabelText('Command for application 3'), { target: { value: 'CHAT' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add application 3' }));
  expect(cfgDraft.value).toContain('\nAPPLICATION 3,CHAT\n');
});

test('Telnet users form never puts a password in the DOM and sends one only when typed', async () => {
  nodePages();
  const { container } = render(<App />);
  await editor();
  fireEvent.click(screen.getByRole('tab', { name: 'Telnet users' }));
  const pw = screen.getByLabelText('New password for sysop') as HTMLInputElement;
  expect(pw.type).toBe('password');
  expect(pw.value).toBe('');
  for (const el of Array.from(container.querySelectorAll('input'))) {
    expect(el.value).not.toContain(USER_PASSWORD);
  }
  expect(container.innerHTML).not.toContain(USER_PASSWORD);
  expect(container.innerHTML).not.toContain(CMS_PASSWORD);
  fireEvent.input(screen.getByLabelText('Callsign for sysop'), { target: { value: 'AD6DM' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply user sysop' }));
  expect(cfgDraft.value).toContain(`USER=sysop,${USER_PASSWORD},AD6DM,,SYSOP`);
  fireEvent.input(screen.getByLabelText('New password for sysop'), { target: { value: 'n3wpass' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply user sysop' }));
  expect(cfgDraft.value).toContain('USER=sysop,n3wpass,AD6DM,,SYSOP');
  expect((screen.getByLabelText('New password for sysop') as HTMLInputElement).value).toBe('');
  expect(container.innerHTML).not.toContain('n3wpass');
});

test('the palette offers the Settings forms', () => {
  nodePages();
  render(<App />);
  const labels = paletteItems().filter((i) => i.group === 'Settings').map((i) => i.label);
  expect(labels).toEqual(['Edit bpq32.cfg', 'Port TXTAIL', 'Applications', 'Telnet users']);
});

test('lineDiff reports removed and added lines with their numbers', () => {
  expect(lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([
    { kind: 'del', a: 2, text: 'b' },
    { kind: 'add', b: 2, text: 'B' },
    { kind: 'add', b: 4, text: 'd' },
  ]);
  expect(lineDiff('x\n', 'x\n')).toEqual([]);
});

test('changeSummary pairs a removed and an added line as one change and counts the rest', () => {
  expect(changeSummary(lineDiff('a\n', 'a\n'))).toBe('No changes');
  expect(changeSummary(lineDiff('a\nb\n', 'a\nB\n'))).toBe('1 line changed');
  expect(changeSummary(lineDiff('a\nb\nc\n', 'a\nB\nx\ny\n'))).toBe('2 lines changed, 1 added');
  expect(changeSummary(lineDiff('a\nb\nc\nd\n', 'a\nB\nd\n'))).toBe('1 line changed, 1 removed');
  expect(changeSummary(lineDiff('a\n', 'a\nb\nc\n'))).toBe('2 lines added');
  expect(changeSummary(lineDiff('a\nb\n', 'a\n'))).toBe('1 line removed');
});

test('a new user that fails to apply keeps its typed password', async () => {
  nodePages();
  render(<App />);
  await editor();
  fireEvent.click(screen.getByRole('tab', { name: 'Telnet users' }));
  fireEvent.input(screen.getByLabelText('New user name'), { target: { value: 'a,b' } });
  fireEvent.input(screen.getByLabelText('Callsign for the new user'), { target: { value: 'N0AB' } });
  fireEvent.input(screen.getByLabelText('Password for the new user'), { target: { value: 'pw1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/comma/);
  expect(screen.getByLabelText('Password for the new user')).toHaveValue('pw1');
  expect(cfgDraft.value).toBe(SAMPLE_CFG);
});

test('the new-user row follows the Telnet port when its number changes', async () => {
  nodePages();
  render(<App />);
  await editor();
  fireEvent.click(screen.getByRole('tab', { name: 'Telnet users' }));
  act(() => editDraft(SAMPLE_CFG.replace(' PORTNUM=1', ' PORTNUM=5')));
  fireEvent.input(screen.getByLabelText('New user name'), { target: { value: 'kid' } });
  fireEvent.input(screen.getByLabelText('Callsign for the new user'), { target: { value: 'KK6XYZ' } });
  fireEvent.input(screen.getByLabelText('Password for the new user'), { target: { value: 'pw1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(cfgDraft.value).toContain(' USER=kid,pw1,KK6XYZ\n');
});

test('a port named TELNET only by PROTOCOL= gets no user form, matching setUser', async () => {
  nodePages({ '/Node/EditCfg.html': editPage('NODECALL=N0CALL\nPORT\n PORTNUM=4\n PROTOCOL=TELNET\n CONFIG\nENDPORT\n') });
  render(<App />);
  await editor();
  fireEvent.click(screen.getByRole('tab', { name: 'Telnet users' }));
  expect(screen.getByText('No Telnet port (DRIVER=TELNET) in bpq32.cfg.')).toBeInTheDocument();
});
