// A stand-in for the browser WebSocket: records what the console sends and lets a test
// play the node's side (open, text frames, close).
export class FakeWS {
  static all: FakeWS[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWS.CONNECTING;
  sent: string[] = [];
  closedByClient = false;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeWS.all.push(this);
  }

  send(data: string): void {
    if (this.readyState !== FakeWS.OPEN) throw new Error('send on a socket that is not open');
    this.sent.push(data);
  }

  close(): void {
    this.closedByClient = true;
    this.readyState = FakeWS.CLOSED;
  }

  // The node's side.
  open(): void {
    this.readyState = FakeWS.OPEN;
    this.onopen?.(new Event('open'));
  }

  recv(text: string): void {
    this.onmessage?.({ data: text });
  }

  serverClose(reason = ''): void {
    this.readyState = FakeWS.CLOSED;
    this.onclose?.({ code: 1000, reason });
  }

  static last(): FakeWS {
    const ws = FakeWS.all[FakeWS.all.length - 1];
    if (!ws) throw new Error('no socket opened');
    return ws;
  }
}

/** The node's input decoder (HTTPcode.c ProcessWebTermInput): %XX is a byte, + is a space. */
export function nodeTermDecode(payload: string): string {
  let out = '';
  for (let i = 0; i < payload.length; i++) {
    const c = payload[i] as string;
    if (c === '%') {
      out += String.fromCharCode(parseInt(payload.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (c === '+') out += ' ';
    else out += c;
  }
  return out;
}
