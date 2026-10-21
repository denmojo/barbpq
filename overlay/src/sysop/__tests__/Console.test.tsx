import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/preact';
import { fixture, stubFetch } from '../../data/__tests__/helpers';
import { sysop } from '../../data/session';
import { expectNoOldPageLinks } from '../../public/__tests__/prime';
import { Console, HIDDEN_CLOSE_MS } from '../Console';
import { pendingCommand, typeCommand } from '../consoleproto';
import { FakeWS } from './fakews';

const TERM = fixture('node-websockterm.html');
const PASSWORD = 'hunter2x';

let setItem: ReturnType<typeof vi.spyOn>;
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
let hidden = false;

beforeEach(() => {
  FakeWS.all = [];
  vi.stubGlobal('WebSocket', FakeWS);
  stubFetch({ '/Node/WebSockTerm.html': TERM });
  setItem = vi.spyOn(Storage.prototype, 'setItem');
  for (const m of ['log', 'info', 'debug', 'warn', 'error'] as const) consoleSpies.push(vi.spyOn(console, m));
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  sysop.value = 'in';
  pendingCommand.value = null;
});
afterEach(() => {
  // Ruling: scrollback and history never reach browser storage or the console.
  expect(setItem).not.toHaveBeenCalled();
  for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
  setItem.mockRestore();
  for (const s of consoleSpies.splice(0)) s.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sysop.value = 'unknown';
  document.documentElement.removeAttribute('data-theme');
});

async function connected(): Promise<FakeWS> {
  await waitFor(() => expect(FakeWS.all).toHaveLength(1));
  const ws = FakeWS.last();
  act(() => ws.open());
  await screen.findByText('Connected');
  return ws;
}

const input = () => screen.getByRole('textbox', { name: 'Command' }) as HTMLInputElement;
function typeLine(text: string): void {
  fireEvent.input(input(), { target: { value: text } });
  fireEvent.submit(input().closest('form') as HTMLFormElement);
}

test('the console shows node output in the dark terminal panel and sends what is typed', async () => {
  const { container } = render(<Console />);
  const ws = await connected();
  act(() => ws.recv('*** Connected\r\n'));
  typeLine('?');
  expect(ws.sent).toEqual(['?\r']);
  act(() => { ws.recv('\r\n'); ws.recv('EGNOD:AD6DM-11} RMS BBS CONNECT BYE INFO NODES PORTS\r\n'); });
  const log = screen.getByRole('log', { name: 'Console output' });
  expect(log.closest('.term')).not.toBeNull();
  expect(log).toHaveTextContent('*** Connected');
  expect(log).toHaveTextContent('EGNOD:AD6DM-11} RMS BBS CONNECT BYE INFO NODES PORTS');
  expect(log.querySelector('.in')).toHaveTextContent('?');
  expect(input().value).toBe('');
  expectNoOldPageLinks(container);
  expect(container.innerHTML).not.toMatch(/WebSockTerm|\/Node\//);
  expect(container.innerHTML).not.toContain(PASSWORD);
});

test('the terminal panel is dark in the light theme too: its colours are theme-independent tokens', async () => {
  document.documentElement.setAttribute('data-theme', 'light');
  render(<Console />);
  await connected();
  expect(screen.getByRole('log', { name: 'Console output' }).closest('.term')).not.toBeNull();
  const css = readFileSync(join(__dirname, '..', 'console.css'), 'utf8');
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  expect(root).toMatch(/--term-bg:\s*#0e1013/);
  expect(root).toMatch(/--term-text:\s*#c9d1d9/);
  expect(css).not.toMatch(/data-theme/);
  expect(css).toMatch(/\.term\s*\{[^}]*background:\s*var\(--term-bg\)/);
});

test('Up and Down walk the in-memory command history', async () => {
  render(<Console />);
  await connected();
  typeLine('PORTS');
  typeLine('USERS');
  fireEvent.keyDown(input(), { key: 'ArrowUp' });
  expect(input().value).toBe('USERS');
  fireEvent.keyDown(input(), { key: 'ArrowUp' });
  expect(input().value).toBe('PORTS');
  fireEvent.keyDown(input(), { key: 'ArrowDown' });
  expect(input().value).toBe('USERS');
  fireEvent.keyDown(input(), { key: 'ArrowDown' });
  expect(input().value).toBe('');
});

test('a password prompt from the node masks the input and its echo', async () => {
  render(<Console />);
  const ws = await connected();
  act(() => ws.recv('Password: '));
  expect(screen.getByLabelText('Command')).toHaveAttribute('type', 'password');
  fireEvent.input(screen.getByLabelText('Command'), { target: { value: 'sekrit99' } });
  fireEvent.submit(screen.getByLabelText('Command').closest('form') as HTMLFormElement);
  expect(ws.sent).toEqual(['sekrit99\r']);
  expect(screen.getByRole('log', { name: 'Console output' })).not.toHaveTextContent('sekrit99');
});

test('a quick command pill sends a read-only command', async () => {
  render(<Console />);
  const ws = await connected();
  fireEvent.click(screen.getByRole('button', { name: 'PORTS' }));
  expect(ws.sent).toEqual(['PORTS\r']);
});

test('unmounting the screen closes the socket', async () => {
  const { unmount } = render(<Console />);
  const ws = await connected();
  unmount();
  expect(ws.closedByClient).toBe(true);
});

test('signing out closes the socket', async () => {
  render(<Console />);
  const ws = await connected();
  act(() => { sysop.value = 'out'; });
  expect(ws.closedByClient).toBe(true);
});

test('a node close shows the reason and a Reconnect button; reconnecting is manual', async () => {
  render(<Console />);
  const ws = await connected();
  act(() => ws.serverClose('Session Timeout'));
  expect(await screen.findByText(/Session Timeout/)).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 20));
  expect(FakeWS.all).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  await waitFor(() => expect(FakeWS.all).toHaveLength(2));
});

test('a tab hidden for the timeout closes the socket; a shorter absence keeps it', async () => {
  render(<Console />);
  const ws = await connected();
  vi.useFakeTimers();
  hidden = true;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  act(() => { vi.advanceTimersByTime(HIDDEN_CLOSE_MS - 1000); });
  hidden = false;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  act(() => { vi.advanceTimersByTime(HIDDEN_CLOSE_MS * 2); });
  expect(ws.closedByClient).toBe(false);
  hidden = true;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  act(() => { vi.advanceTimersByTime(HIDDEN_CLOSE_MS); });
  expect(ws.closedByClient).toBe(true);
  expect(screen.getByText(/hidden tab/)).toBeInTheDocument();
  expect(HIDDEN_CLOSE_MS).toBe(5 * 60_000);
});

test('a command queued by typeCommand is sent once the console connects, once', async () => {
  typeCommand('PORTS');
  render(<Console />);
  const ws = await connected();
  expect(ws.sent).toEqual(['PORTS\r']);
  expect(screen.getByRole('log', { name: 'Console output' }).querySelector('.in')).toHaveTextContent('PORTS');
  expect(pendingCommand.value).toBeNull();
});

test('a queued command is dropped, and says so, when the console cannot connect', async () => {
  stubFetch({ '/Node/WebSockTerm.html': '<html>no terminal</html>' });
  typeCommand('PORTS');
  render(<Console />);
  expect(await screen.findByText(/PORTS was not sent/)).toBeInTheDocument();
  expect(pendingCommand.value).toBeNull();
  expect(FakeWS.all).toHaveLength(0);
});

test('typeCommand while the console is already open sends at once', async () => {
  render(<Console />);
  const ws = await connected();
  act(() => typeCommand('USERS'));
  expect(ws.sent).toEqual(['USERS\r']);
  expect(pendingCommand.value).toBeNull();
});

test('Reconnect is debounced: a double click opens one socket', async () => {
  render(<Console />);
  const ws = await connected();
  act(() => ws.serverClose('Session Timeout'));
  const btn = await screen.findByRole('button', { name: 'Reconnect' });
  fireEvent.click(btn);
  fireEvent.click(btn);
  await waitFor(() => expect(FakeWS.all).toHaveLength(2));
  await new Promise((r) => setTimeout(r, 30));
  expect(FakeWS.all).toHaveLength(2);
});

test('only a password word masks the input: a prompt ending in "Compass>" does not', async () => {
  render(<Console />);
  const ws = await connected();
  act(() => ws.recv('Compass> '));
  expect(screen.getByLabelText('Command')).toHaveAttribute('type', 'text');
  act(() => ws.recv('\r\nPass: '));
  expect(screen.getByLabelText('Command')).toHaveAttribute('type', 'password');
});
