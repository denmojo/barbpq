// The node's WebSocket terminal (HTTPcode.c DoWebSockTerm, ProcessNewTermWebSock,
// ProcessWebTermInput, PollWebSockSession; TelnetV6.c frames it).
//
// Sign-in: GET the terminal page with the node cookie. The node answers with a page whose
// script opens /WEBTERM?<key>&<call>&<password>&<secure>, where <key> names a fresh 'T'
// session already tied to the signed-in sysop. The node finds the session by key alone, so
// this client sends only the key and leaves call and password blank: the password never
// goes into a URL. Without the cookie the node answers with its terminal sign-in form.
//
// Frames: text both ways. In: one line plus CR; the node %-decodes it and reads + as a space,
// then echoes CRLF in a frame of its own. Out: UTF-8 text with CRLF line ends; a frame can end
// mid-line (a prompt). The node closes an idle session after about 15 minutes ("Session Timeout").
import { signal } from '@preact/signals';
import { navigate } from '../app/router';
import { getText, NonLatin1Error, ParseError } from '../data/http';
import { NotAuthorizedError, sysop } from '../data/session';

/**
 * Fetched as data only; no element of this UI links, frames or navigates to it. Each fetch makes
 * the node allocate a 'T' session (DoWebSockTerm). Closing the socket frees its host stream
 * (ProcessWebTermClosed), but the session record stays in the node's list until its idle kill,
 * about 15 minutes later, so connects are rate-limited by the screen (Reconnect is debounced).
 */
const TERM_PAGE = '/Node/WebSockTerm.html';

/** ProcessWebTermInput decodes into a 512-byte buffer; stay well inside it. */
export const MAX_LINE = 250;

export class LineTooLongError extends Error {
  constructor(readonly length: number) {
    super(`The line is ${length} characters; the node takes at most ${MAX_LINE}`);
    this.name = 'LineTooLongError';
  }
}

export class ControlCharError extends Error {
  constructor(readonly position: number) {
    super(`The line has a control character at position ${position}; only tab is allowed`);
    this.name = 'ControlCharError';
  }
}

/** The session key from the terminal page. Throws NotAuthorizedError for the sign-in form. */
export function parseTermKey(html: string): string {
  if (/action=["']?\/?(?:Node\/)?TermSignon\b/i.test(html)) {
    sysop.value = 'out';
    throw new NotAuthorizedError();
  }
  const m = /\/WEBTERM\?(T[0-9A-Fa-f]+)&/.exec(html);
  if (!m) throw new ParseError('Web terminal', 'session key');
  return m[1] as string;
}

export function termSocketUrl(loc: { protocol: string; host: string }, key: string): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/WEBTERM?${key}&&&0`;
}

/**
 * One typed line as the node must receive it. % and + are escaped so the node's decoder gives
 * them back; U+0080-U+00FF go as %XX bytes, so the frame is plain ASCII. Control characters
 * other than tab are refused.
 */
export function encodeLine(text: string): string {
  if (text.length > MAX_LINE) throw new LineTooLongError(text.length);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0xff) throw new NonLatin1Error(i, text[i] as string);
    // A CR or LF would make the node run the rest as a second command.
    if (c < 0x20 && c !== 0x09) throw new ControlCharError(i);
    if (c === 0x25 || c === 0x2b || c >= 0x80) out += `%${c.toString(16).toUpperCase().padStart(2, '0')}`;
    else out += text[i];
  }
  return `${out}\r`;
}

/** Splits node output into lines; `partial` is the unterminated tail (often a prompt). */
export class OutputSplitter {
  partial = '';
  private afterCr = false;

  push(chunk: string): string[] {
    const lines: string[] = [];
    for (const ch of chunk) {
      if (ch === '\n' && this.afterCr) { this.afterCr = false; continue; }
      this.afterCr = ch === '\r';
      if (ch === '\r' || ch === '\n') {
        lines.push(this.partial);
        this.partial = '';
      } else this.partial += ch;
    }
    return lines;
  }

  clear(): void {
    this.partial = '';
  }
}

const SIGNED_OUT = 'Signed out: sign in again to use the console';

export type ConsoleStatus = 'connecting' | 'open' | 'closed';

export interface ConsoleConn {
  readonly status: ConsoleStatus;
  /**
   * Send one typed line; `shown` is how notes name it (a masked password shows as stars).
   * Throws when not connected, or for a line the node cannot take.
   */
  send(line: string, shown?: string): void;
  /** Lines the connection could not deliver (echo timeout, close with lines queued). */
  onNote(cb: (text: string) => void): () => void;
  /** Each complete output line. Returns an unsubscribe function. */
  onLine(cb: (line: string) => void): () => void;
  /** The unterminated tail after each frame ('' once it completes or a line is sent). */
  onPartial(cb: (text: string) => void): () => void;
  /** Status changes; `reason` says why a console closed. */
  onStatus(cb: (status: ConsoleStatus, reason?: string) => void): () => void;
  close(reason?: string): void;
}

/**
 * The node echoes while it handles a line, within a tick of reading it; 5 s allows for a busy
 * node or a slow link and is still short enough that a stuck queue shows quickly.
 */
export const ECHO_TIMEOUT_MS = 5000;

interface Line { frame: string; shown: string }

const notSent = (ls: Line[], why: string): string =>
  `${ls.map((l) => l.shown).join(', ')} ${ls.length === 1 ? 'was' : 'were'} not sent${why}`;

function listeners<A extends unknown[]>() {
  const set = new Set<(...a: A) => void>();
  return {
    add(cb: (...a: A) => void) { set.add(cb); return () => { set.delete(cb); }; },
    emit(...a: A) { for (const cb of Array.from(set)) cb(...a); },
  };
}

/** Open a console session on the node. Nothing it sends or receives is kept here. */
export function openConsole(): ConsoleConn {
  const lines = listeners<[string]>();
  const partials = listeners<[string]>();
  const statuses = listeners<[ConsoleStatus, string | undefined]>();
  const notes = listeners<[string]>();
  const splitter = new OutputSplitter();
  let status = 'connecting' as ConsoleStatus;
  let ws: WebSocket | null = null;
  // TelnetV6.c handles one WebSocket frame per recv() and drops the rest of the buffer
  // (InputLen = 0), so two frames that coalesce lose the second. Keep one line in flight: the
  // node's CRLF echo is sent while it handles the line, so after the echo the next may go.
  let inFlight: Line | null = null;
  let echoTimer: ReturnType<typeof setTimeout> | undefined;
  const queue: Line[] = [];
  const write = (l: Line) => {
    ws?.send(l.frame);
    inFlight = l;
    clearTimeout(echoTimer);
    echoTimer = setTimeout(onEchoTimeout, ECHO_TIMEOUT_MS);
  };
  const echoed = () => {
    clearTimeout(echoTimer);
    inFlight = null;
    const next = queue.shift();
    if (next) write(next);
  };
  // No echo: the node may not have read the line. Report it and drop the queue rather than block
  // the console for good; the socket stays open, so the sysop can type again.
  function onEchoTimeout(): void {
    const lost = inFlight;
    inFlight = null;
    const queued = queue.splice(0);
    const parts = [`No echo from the node within ${ECHO_TIMEOUT_MS / 1000} s for ${lost?.shown ?? 'the last line'}: it may not have run`];
    if (queued.length) parts.push(notSent(queued, ''));
    notes.emit(parts.join('; '));
  }

  const setStatus = (s: ConsoleStatus, reason?: string) => {
    status = s;
    statuses.emit(s, reason);
  };

  const finish = (reason: string) => {
    if (status === 'closed') return;
    stopWatch();
    clearTimeout(echoTimer);
    inFlight = null;
    const queued = queue.splice(0);
    if (queued.length) notes.emit(notSent(queued, ': the console closed'));
    const sock = ws;
    ws = null;
    if (sock) {
      sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
      sock.close();
    }
    setStatus('closed', reason);
  };

  // Signing out ends the console, whichever screen is showing.
  let stopWatch: () => void = () => {};
  const unwatch = sysop.subscribe((v) => { if (v === 'out') finish(SIGNED_OUT); });
  stopWatch = unwatch;
  if (status === 'closed') unwatch();

  void (async () => {
    let key: string;
    try {
      // no-store: each fetch must reach the node, which mints a fresh session key.
      key = parseTermKey(await getText(TERM_PAGE, { cache: 'no-store' }));
    } catch (e) {
      finish(e instanceof NotAuthorizedError ? SIGNED_OUT
        : `Could not start a console: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (status === 'closed') return;
    const sock = new WebSocket(termSocketUrl(location, key));
    ws = sock;
    sock.onopen = () => setStatus('open');
    sock.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      // Frames carry no tag: the first bare CRLF after a send is taken as its echo. A blank
      // output line that comes first is taken instead and the echo then shows as that blank
      // line, so the screen reads the same.
      if (inFlight && e.data === '\r\n') {
        echoed();
        return;
      }
      for (const l of splitter.push(e.data)) lines.emit(l);
      partials.emit(splitter.partial);
    };
    sock.onclose = (e: CloseEvent) => finish(e.reason ? `The node closed the console: ${e.reason}` : 'The node closed the console');
  })();

  return {
    get status() { return status; },
    send(line: string, shown = line) {
      if (status !== 'open' || !ws) throw new Error('The console is not connected');
      const l = { frame: encodeLine(line), shown };
      if (inFlight) queue.push(l);
      else write(l);
      splitter.clear();
      partials.emit('');
    },
    onLine: lines.add,
    onPartial: partials.add,
    onNote: notes.add,
    onStatus: (cb) => statuses.add(cb),
    close: (reason = 'Closed') => finish(reason),
  };
}

/** A command a shortcut asked the console to type; the Console screen sends it once connected. */
export const pendingCommand = signal<string | null>(null);

/** Open the console screen and type `text` there once it connects. */
export function typeCommand(text: string): void {
  encodeLine(text); // refuse a line the node cannot take before opening anything
  pendingCommand.value = text;
  navigate('console');
}

export function takePendingCommand(): string | null {
  const c = pendingCommand.peek();
  pendingCommand.value = null;
  return c;
}
