import { fixture, stubFetch } from '../../data/__tests__/helpers';
import { NonLatin1Error, ParseError } from '../../data/http';
import { NotAuthorizedError, sysop } from '../../data/session';
import { route } from '../../app/router';
import {
  encodeLine, LineTooLongError, MAX_LINE, openConsole, OutputSplitter, parseTermKey,
  pendingCommand, takePendingCommand, termSocketUrl, typeCommand, type ConsoleStatus,
} from '../consoleproto';
import { FakeWS, nodeTermDecode } from './fakews';

const TERM = fixture('node-websockterm.html');
const PASSWORD = 'hunter2x';

let setItem: ReturnType<typeof vi.spyOn>;
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  FakeWS.all = [];
  vi.stubGlobal('WebSocket', FakeWS);
  setItem = vi.spyOn(Storage.prototype, 'setItem');
  for (const m of ['log', 'info', 'debug', 'warn', 'error'] as const) consoleSpies.push(vi.spyOn(console, m));
  sysop.value = 'in';
  pendingCommand.value = null;
});
afterEach(() => {
  // Ruling: nothing typed or received is stored or logged.
  expect(setItem).not.toHaveBeenCalled();
  for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
  setItem.mockRestore();
  for (const s of consoleSpies.splice(0)) s.mockRestore();
  vi.unstubAllGlobals();
  sysop.value = 'unknown';
});

test('parseTermKey reads the T session key from the node terminal page and nothing else', () => {
  expect(parseTermKey(TERM)).toBe('T000085546956');
  expect(() => parseTermKey('<html>no terminal</html>')).toThrow(ParseError);
});

test('parseTermKey: the terminal sign-in form means the node cookie is gone', () => {
  expect(() => parseTermKey(fixture('node-termsignon.html'))).toThrow(NotAuthorizedError);
  expect(sysop.value).toBe('out');
});

test('termSocketUrl keeps the key, blanks call and password, follows http/https', () => {
  expect(termSocketUrl({ protocol: 'http:', host: 'node:8008' }, 'T00ABC')).toBe('ws://node:8008/WEBTERM?T00ABC&&&0');
  expect(termSocketUrl({ protocol: 'https:', host: 'node' }, 'T00ABC')).toBe('wss://node/WEBTERM?T00ABC&&&0');
});

test('encodeLine escapes % and + so the node decoder returns the typed text, then adds CR', () => {
  for (const text of ['?', 'a+b%c d', 'CONNECT 2 W6SAR-10', 'café ÿ', '%', '+']) {
    const sent = encodeLine(text);
    expect(sent.endsWith('\r')).toBe(true);
    expect(sent).toMatch(/^[\x09\x20-\x7e]*\r$/); // ASCII only: the browser's UTF-8 is then byte for byte
    expect(nodeTermDecode(sent)).toBe(`${text}\r`);
  }
  expect(encodeLine('a+b%c')).toBe('a%2Bb%25c\r');
});

test('encodeLine refuses text the node cannot take', () => {
  expect(() => encodeLine('€5')).toThrow(NonLatin1Error);
  expect(() => encodeLine('x'.repeat(MAX_LINE + 1))).toThrow(LineTooLongError);
  expect(() => encodeLine('%'.repeat(MAX_LINE))).not.toThrow();
});

test('OutputSplitter turns text frames into lines and keeps the unterminated tail', () => {
  const s = new OutputSplitter();
  expect(s.push('*** Connected\r\n')).toEqual(['*** Connected']);
  expect(s.push('EGNOD:AD6DM-11} RMS')).toEqual([]);
  expect(s.partial).toBe('EGNOD:AD6DM-11} RMS');
  expect(s.push(' BBS\r\nline 2\r')).toEqual(['EGNOD:AD6DM-11} RMS BBS', 'line 2']);
  expect(s.push('\nCMS>')).toEqual([]);
  expect(s.partial).toBe('CMS>');
  expect(s.push('\n\n')).toEqual(['CMS>', '']);
});

async function opened(): Promise<{ conn: ReturnType<typeof openConsole>; ws: FakeWS; statuses: ConsoleStatus[] }> {
  const statuses: ConsoleStatus[] = [];
  const conn = openConsole();
  conn.onStatus((s) => statuses.push(s));
  await vi.waitFor(() => expect(FakeWS.all).toHaveLength(1));
  const ws = FakeWS.last();
  ws.open();
  return { conn, ws, statuses };
}

test('openConsole fetches the terminal page, opens the socket without the password, and talks lines', async () => {
  const calls = stubFetch({ '/Node/WebSockTerm.html': TERM });
  const { conn, ws, statuses } = await opened();
  expect(calls.map((c) => c.url)).toEqual(['/Node/WebSockTerm.html']);
  expect(ws.url).toBe(`ws://${location.host}/WEBTERM?T000085546956&&&0`);
  expect(ws.url).not.toContain(PASSWORD);
  expect(statuses).toEqual(['open']);
  expect(conn.status).toBe('open');

  const lines: string[] = [];
  const partials: string[] = [];
  conn.onLine((l) => lines.push(l));
  conn.onPartial((p) => partials.push(p));
  ws.recv('*** Connected\r\n');
  conn.send('?');
  expect(ws.sent).toEqual(['?\r']);
  ws.recv('\r\n'); // the node echoes CRLF for each input line; the console already shows the line
  ws.recv('EGNOD:AD6DM-11} RMS BBS CONNECT BYE\r\nCMS>');
  expect(lines).toEqual(['*** Connected', 'EGNOD:AD6DM-11} RMS BBS CONNECT BYE']);
  expect(partials[partials.length - 1]).toBe('CMS>');

  conn.close();
  expect(ws.closedByClient).toBe(true);
  expect(conn.status).toBe('closed');
  expect(() => conn.send('x')).toThrow(/not connected/);
});

test('openConsole: a node close reports the reason; nothing reconnects by itself', async () => {
  stubFetch({ '/Node/WebSockTerm.html': TERM });
  const { conn, ws } = await opened();
  const reasons: (string | undefined)[] = [];
  conn.onStatus((_s, r) => reasons.push(r));
  ws.serverClose('Session Timeout');
  expect(conn.status).toBe('closed');
  expect(reasons[0]).toMatch(/Session Timeout/);
  await new Promise((r) => setTimeout(r, 20));
  expect(FakeWS.all).toHaveLength(1);
});

test('openConsole closes the socket when the sysop signs out', async () => {
  stubFetch({ '/Node/WebSockTerm.html': TERM });
  const { conn, ws } = await opened();
  sysop.value = 'out';
  expect(ws.closedByClient).toBe(true);
  expect(conn.status).toBe('closed');
});

test('openConsole: a signed-out terminal page closes with a sign-in reason and opens no socket', async () => {
  stubFetch({ '/Node/WebSockTerm.html': fixture('node-termsignon.html') });
  const conn = openConsole();
  const reasons: (string | undefined)[] = [];
  conn.onStatus((_s, r) => reasons.push(r));
  await vi.waitFor(() => expect(conn.status).toBe('closed'));
  expect(FakeWS.all).toHaveLength(0);
  expect(reasons.join(' ')).toMatch(/sign in/i);
});

test('close() before the page arrives opens no socket', async () => {
  let release: (v: string) => void = () => {};
  vi.stubGlobal('fetch', () => new Promise<Response>((res) => { release = (t) => res(new Response(t)); }));
  const conn = openConsole();
  conn.close();
  release(TERM);
  await new Promise((r) => setTimeout(r, 20));
  expect(FakeWS.all).toHaveLength(0);
});

test('typeCommand queues one command and opens the console screen', () => {
  typeCommand('RESTART');
  expect(route.value).toBe('console');
  expect(location.hash).toBe('#/console');
  expect(takePendingCommand()).toBe('RESTART');
  expect(takePendingCommand()).toBeNull();
});
