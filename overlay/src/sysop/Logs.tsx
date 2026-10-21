// The node's log files, one day at a time. The node has no log directory: its menu's View Logs
// form names each kind of log, and ShowLog returns one kind for one date. Log text stays in
// this screen's memory only; logs can carry passwords.
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { getText } from '../data/http';
import { fetchLog, parseLogList, type LogFile } from '../data/pages';
import { useOnce } from '../data/poll';
import { withSysop } from '../data/session';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorNote } from '../ui/ErrorNote';
import { Skel } from '../ui/Skel';
import { Footer } from '../public/Footer';
import { IconLogs } from './icons';
import './console.css';

/** Lines drawn at once; a busy Telnet log runs to tens of thousands a day. */
const MAX_SHOWN = 20_000;

/** The node's own log form defaults to today's UTC date. */
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Loaded = { key: string; text: string | null } | { key: string; error: Error };

function highlight(line: string, q: string) {
  if (!q) return line;
  const parts: (string | JSX.Element)[] = [];
  const lower = line.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    parts.push(line.slice(at, i), <mark>{line.slice(i, i + q.length)}</mark>);
    at = i + q.length;
  }
  parts.push(line.slice(at));
  return parts;
}

function LogText({ file, date, text }: { file: LogFile; date: string; text: string }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const lines = useMemo(() => {
    const all = text.split(/\r?\n/);
    if (all.length && all[all.length - 1] === '') all.pop();
    return all;
  }, [text]);
  const matched = useMemo(() => (q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines), [lines, q]);
  const shown = matched.length > MAX_SHOWN ? matched.slice(-MAX_SHOWN) : matched;
  const count = q ? `${matched.length} of ${lines.length} lines` : `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`;
  return (
    <>
      <div class="logs-bar">
        <input type="search" aria-label="Search this log" placeholder="Search this log" value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
      </div>
      <p class="logs-meta">
        <span>{count}</span>
        {shown.length < matched.length && <span>{` · showing the last ${MAX_SHOWN.toLocaleString('en-US')}; search to narrow`}</span>}
      </p>
      <div class="term logs-text" role="region" aria-label={`${file.label}, ${date}`} tabIndex={0}>
        {shown.map((l, i) => <div key={i}>{highlight(l, q) || ' '}</div>)}
      </div>
    </>
  );
}

export function Logs() {
  const menu = useOnce(async () => parseLogList(await getText('/Node/NodeMenu.html')));
  const [date, setDate] = useState(todayUtc);
  const [file, setFile] = useState<LogFile | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const key = file ? `${file.param}|${date}` : '';

  useEffect(() => {
    if (!file) return undefined;
    let alive = true;
    setLoaded(null);
    withSysop(() => fetchLog(file, date)).then(
      (text) => { if (alive) setLoaded({ key, text }); },
      (e: unknown) => { if (alive) setLoaded({ key, error: e instanceof Error ? e : new Error(String(e)) }); },
    );
    return () => { alive = false; };
  }, [key, reload]);

  const current = loaded && loaded.key === key ? loaded : null;
  return (
    <>
      <div class="titlebar">
        <h1>Logs</h1>
        <span class="sub">One file per kind per UTC day</span>
      </div>
      <div class="grid">
        <Card title={file ? file.label : 'Log files'} span={12}>
          <div class="logs-bar">
            <button type="button" class="btn" aria-label="Previous day" onClick={() => setDate(shiftDay(date, -1))}>‹</button>
            <input type="date" aria-label="Day (UTC)" value={date} max={todayUtc()}
              onChange={(e) => { const v = (e.target as HTMLInputElement).value; if (v) setDate(v); }} />
            <button type="button" class="btn" aria-label="Next day" disabled={date >= todayUtc()} onClick={() => setDate(shiftDay(date, 1))}>›</button>
            {file && <button type="button" class="btn" onClick={() => setReload(reload + 1)}>Reload</button>}
          </div>
          {menu.error ? <ErrorNote error={menu.error} /> : !menu.data ? <Skel /> : (
            <ul class="logs-files" aria-label="Log files">
              {menu.data.map((f) => (
                <li key={f.param}>
                  <button type="button" class="btn" aria-pressed={file?.param === f.param ? 'true' : 'false'} onClick={() => setFile(f)}>{f.label}</button>
                </li>
              ))}
            </ul>
          )}
          {!file ? (
            <EmptyState icon={<IconLogs />} title="Pick a log" hint="Choose a kind of log and a day." />
          ) : !current ? <Skel /> : 'error' in current ? <ErrorNote error={current.error} /> : current.text === null ? (
            <EmptyState icon={<IconLogs />} title={`No ${file.label} for ${date}`} hint="The node has no file of this kind for that day." />
          ) : (
            <LogText key={key} file={file} date={date} text={current.text} />
          )}
        </Card>
      </div>
      <Footer />
    </>
  );
}
