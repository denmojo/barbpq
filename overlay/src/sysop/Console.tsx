// The native SysOp console over the node's WebSocket terminal. Scrollback and command history
// live in this component's memory only: some commands print passwords or keys, so nothing is
// written to browser storage or the developer console, and it all goes when the screen closes.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Footer } from '../public/Footer';
import { MAX_LINE, openConsole, pendingCommand, takePendingCommand, typeCommand, type ConsoleConn, type ConsoleStatus } from './consoleproto';
import { registerPaletteItems } from './palette';
import './console.css';

/**
 * A console in a tab hidden this long is closed. A short look at another tab keeps the session;
 * a forgotten tab frees the node's host stream ten minutes before the node's own 15-minute
 * idle timeout would.
 */
export const HIDDEN_CLOSE_MS = 5 * 60_000;

/** Reconnect clicks closer together than this are ignored. */
const RECONNECT_GAP_MS = 1000;

/** Scrollback kept on screen; older lines drop off the top. */
const MAX_LINES = 5000;

/** Read-only node commands offered as one-click pills (Cmd.c COMMANDS table). */
export const QUICK_COMMANDS = ['?', 'PORTS', 'NODES', 'ROUTES', 'USERS'] as const;

/** A node or BBS asking for a password: mask the input and its echo. */
const SECRET_PROMPT = /\bpass(?:word)?\s*[:>]?\s*$/i;
const MASK = '********';

const QUICK_LABELS: Record<(typeof QUICK_COMMANDS)[number], string> = {
  '?': 'list commands', PORTS: 'ports', NODES: 'known nodes', ROUTES: 'routes', USERS: 'connected users',
};

/** Palette entries that type a read-only command into the console. Nothing that changes node state. */
export function useConsolePalette(): void {
  useEffect(() => registerPaletteItems(QUICK_COMMANDS.map((c) => ({
    label: `Console: ${QUICK_LABELS[c]} (${c})`,
    action: () => typeCommand(c),
    group: 'Console',
    keywords: `terminal command ${c.toLowerCase()}`,
  }))), []);
}

interface Entry { id: number; kind: 'out' | 'in' | 'note'; text: string; prompt?: string }

const STATUS_TEXT: Record<Exclude<ConsoleStatus, 'closed'>, string> = { connecting: 'Connecting', open: 'Connected' };

export function Console() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [partial, setPartial] = useState('');
  const [status, setStatus] = useState<ConsoleStatus>('connecting');
  const [reason, setReason] = useState<string | undefined>();
  const [text, setText] = useState('');
  const conn = useRef<ConsoleConn | null>(null);
  const prompt = useRef('');
  const history = useRef<string[]>([]);
  const histPos = useRef(0);
  const nextId = useRef(0);
  const out = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const last = entries[entries.length - 1];
  const secret = SECRET_PROMPT.test(partial) || (partial === '' && last?.kind === 'out' && SECRET_PROMPT.test(last.text));

  const add = (e: Omit<Entry, 'id'>) => setEntries((es) => {
    const next = [...es, { ...e, id: nextId.current++ }];
    return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
  });

  const sendLine = (line: string, masked = false): boolean => {
    const c = conn.current;
    if (!c || c.status !== 'open') return false;
    const before = prompt.current;
    try {
      c.send(line, masked ? MASK : line);
    } catch (e) {
      add({ kind: 'note', text: e instanceof Error ? e.message : String(e) });
      return false;
    }
    add({ kind: 'in', prompt: before, text: masked ? MASK : line });
    return true;
  };

  const connect = () => {
    conn.current?.close();
    const c = openConsole();
    conn.current = c;
    prompt.current = '';
    setPartial('');
    setStatus('connecting');
    setReason(undefined);
    c.onLine((l) => add({ kind: 'out', text: l }));
    c.onPartial((p) => { prompt.current = p; setPartial(p); });
    c.onNote((n) => { if (conn.current === c) add({ kind: 'note', text: n }); });
    c.onStatus((s, r) => {
      if (conn.current !== c) return;
      setStatus(s);
      if (s === 'open') {
        const cmd = takePendingCommand();
        if (cmd) sendLine(cmd);
        input.current?.focus();
      } else if (s === 'closed') {
        setReason(r);
        const cmd = takePendingCommand();
        if (cmd) add({ kind: 'note', text: `${cmd} was not sent: ${r ?? 'the console closed'}` });
      }
    });
  };

  // Each connect makes the node allocate a session it keeps until its idle kill: one per second at most.
  const lastReconnect = useRef(0);
  const reconnect = () => {
    const now = Date.now();
    if (now - lastReconnect.current < RECONNECT_GAP_MS) return;
    lastReconnect.current = now;
    connect();
  };

  // typeCommand while this screen is mounted: send at once if open; a closed console drops it
  // so it cannot fire after a later Reconnect.
  useEffect(() => pendingCommand.subscribe((cmd) => {
    const st = conn.current?.status;
    // No connection yet (mounting) or one connecting: that attempt's open or close settles it.
    if (cmd === null || st === undefined || st === 'connecting') return;
    const c = takePendingCommand();
    if (!c) return;
    if (st === 'open') sendLine(c);
    else add({ kind: 'note', text: `${c} was not sent: the console is closed` });
  }), []);

  useEffect(() => {
    connect();
    return () => {
      const c = conn.current;
      conn.current = null;
      c?.close();
      pendingCommand.value = null;
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      clearTimeout(timer);
      timer = undefined;
      if (document.hidden) {
        timer = setTimeout(() => conn.current?.close(`Closed after ${HIDDEN_CLOSE_MS / 60_000} minutes in a hidden tab`), HIDDEN_CLOSE_MS);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    const el = out.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, partial]);

  const onSubmit = (e: Event) => {
    e.preventDefault();
    if (!sendLine(text, secret)) return;
    if (!secret && text.trim()) history.current.push(text);
    histPos.current = history.current.length;
    setText('');
  };

  const onKey = (e: KeyboardEvent) => {
    const h = history.current;
    if (e.key === 'ArrowUp' && histPos.current > 0) {
      e.preventDefault();
      histPos.current--;
      setText(h[histPos.current] ?? '');
    } else if (e.key === 'ArrowDown' && histPos.current < h.length) {
      e.preventDefault();
      histPos.current++;
      setText(h[histPos.current] ?? '');
    }
  };

  const open = status === 'open';
  return (
    <>
      <div class="titlebar">
        <h1>Console</h1>
        <span class="sub">{status === 'closed' ? reason ?? 'Closed' : STATUS_TEXT[status]}</span>
        <div class="title-actions">
          {status === 'open'
            ? <button key="disconnect" type="button" class="btn" onClick={() => conn.current?.close('Disconnected')}>Disconnect</button>
            : <button key="reconnect" type="button" class="btn primary" disabled={status === 'connecting'} onClick={reconnect}>Reconnect</button>}
        </div>
      </div>
      <section class="term term-full" aria-label="Node console">
        <div class="bar">
          {QUICK_COMMANDS.map((c) => (
            <button key={c} type="button" class="pill" disabled={!open} onClick={() => sendLine(c)}>{c}</button>
          ))}
        </div>
        <div class="term-out" ref={out} role="log" aria-label="Console output" tabIndex={0}
          onClick={() => { if (!window.getSelection()?.toString()) input.current?.focus(); }}>
          {entries.map((e) => (
            <div key={e.id} class={e.kind === 'out' ? (e.text.startsWith('***') ? 'ok' : undefined) : e.kind}>
              {e.kind === 'in' ? <><span class="dim">{e.prompt}</span>{e.text}</> : e.text || ' '}
            </div>
          ))}
        </div>
        <form class="term-in" onSubmit={onSubmit}>
          <span class="dim">{partial || '>'}</span>
          <input
            ref={input}
            type={secret ? 'password' : 'text'}
            aria-label="Command"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            maxLength={MAX_LINE}
            disabled={!open}
            value={text}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            onKeyDown={onKey}
          />
        </form>
      </section>
      <Footer />
    </>
  );
}
