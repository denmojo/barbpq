// Parsers for the node's old HTML pages. They throw ParseError naming the page and field.
import { getText, ParseError } from './http';
import { getProtected } from './session';

const doc = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');
const clean = (s: string | null | undefined): string => (s ?? '').replace(/ /g, ' ').trim();

export interface Stats {
  version: string;
  /** As printed: days:hours:minutes. */
  uptime: string;
  uptimeMinutes: number;
  semaphore: { getRel: number; clashes: number };
  buffers: { max: number; cur: number; min: number; out: number; wait: number };
  knownNodes: number;
  maxNodes: number;
  l4: { connectsSent: number; connectsRxed: number; framesTx: number; framesRx: number; resent: number; reseq: number };
  l3Relayed: number;
}

function statRow(d: Document, label: string, count: number): number[] {
  const row = Array.from(d.querySelectorAll('tr')).find((tr) =>
    clean(tr.cells[0]?.textContent).toLowerCase().startsWith(label.toLowerCase()));
  if (!row) throw new ParseError('Stats', label);
  const texts = Array.from(row.cells).slice(1, 1 + count).map((c) => clean(c.textContent));
  if (texts.length < count || texts.some((t) => t === '')) throw new ParseError('Stats', label);
  const nums = texts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) throw new ParseError('Stats', label);
  return nums;
}

export function parseStats(html: string): Stats {
  const d = doc(html);
  const textRow = (label: string): string => {
    const row = Array.from(d.querySelectorAll('tr')).find((tr) => clean(tr.cells[0]?.textContent).startsWith(label));
    const v = clean(row?.cells[1]?.textContent);
    if (!v) throw new ParseError('Stats', label);
    return v;
  };
  const version = textRow('Version');
  const uptime = textRow('Uptime');
  const up = /^(\d+):(\d+):(\d+)$/.exec(uptime);
  if (!up) throw new ParseError('Stats', 'Uptime');
  const sem = statRow(d, 'Semaphore', 2) as [number, number];
  const buf = statRow(d, 'Buffers', 5) as [number, number, number, number, number];
  const nodes = statRow(d, 'Known Nodes', 2) as [number, number];
  const conn = statRow(d, 'L4 Connects', 2) as [number, number];
  const fr = statRow(d, 'L4 Frames', 4) as [number, number, number, number];
  const l3 = statRow(d, 'L3 Frames', 1) as [number];
  return {
    version,
    uptime,
    uptimeMinutes: Number(up[1]) * 1440 + Number(up[2]) * 60 + Number(up[3]),
    semaphore: { getRel: sem[0], clashes: sem[1] },
    buffers: { max: buf[0], cur: buf[1], min: buf[2], out: buf[3], wait: buf[4] },
    knownNodes: nodes[0],
    maxNodes: nodes[1],
    l4: { connectsSent: conn[0], connectsRxed: conn[1], framesTx: fr[0], framesRx: fr[1], resent: fr[2], reseq: fr[3] },
    l3Relayed: l3[0],
  };
}

export interface Route {
  port: number;
  /** Row marked with '>': an L2 link to the neighbour is up. */
  active: boolean;
  call: string;
  /** '', '!', '!!' or '!!!': locked by config, sysop, or both. */
  locked: string;
  quality: number;
  nodeCount: number;
  frames: number;
  retries: number;
  percent: number;
  maxframe: number;
  frack: number;
  lastHeard: string;
  queued: number;
  remQuality: number;
  /** INP3 round-trip times in seconds; null on a non-INP3 route. */
  srtt: number | null;
  remSrtt: number | null;
}

export function parseRoutes(html: string): Route[] {
  const d = doc(html);
  const heading = Array.from(d.querySelectorAll('th')).find((th) => clean(th.textContent) === 'Call');
  const table = heading?.closest('table');
  if (!table) throw new ParseError('Routes', 'routes table');
  const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.querySelector('td'));
  return rows.map((tr, i) => {
    const c = Array.from(tr.cells).map((cell) => clean(cell.textContent));
    const num = (idx: number, field: string): number => {
      const n = parseInt((c[idx] ?? '').replace('%', ''), 10);
      if (Number.isNaN(n)) throw new ParseError('Routes', `${field} (row ${i + 1})`);
      return n;
    };
    const portCell = /^(>?)\s*(\d+)$/.exec(c[0] ?? '');
    const callCell = /^([A-Za-z0-9-]+)\s*(!*)$/.exec(c[1] ?? '');
    if (!portCell) throw new ParseError('Routes', `port (row ${i + 1})`);
    if (!callCell) throw new ParseError('Routes', `call (row ${i + 1})`);
    const secs = (idx: number): number | null => {
      const m = /^([\d.]+)s$/.exec(c[idx] ?? '');
      return m ? Number(m[1]) : null;
    };
    return {
      port: Number(portCell[2]),
      active: portCell[1] === '>',
      call: callCell[1] as string,
      locked: callCell[2] as string,
      quality: num(2, 'quality'),
      nodeCount: num(3, 'node count'),
      frames: num(4, 'frame count'),
      retries: num(5, 'retries'),
      percent: num(6, 'percent'),
      maxframe: num(7, 'maxframe'),
      frack: num(8, 'frack'),
      lastHeard: c[9] ?? '',
      queued: num(10, 'queued'),
      remQuality: num(11, 'remote quality'),
      srtt: secs(12),
      remSrtt: secs(13),
    };
  });
}

/** Mail pages carry a session key in the query string of their menu links (/Mail/Status?<key>). */
export function parseMailKey(html: string): string | null {
  const m = /\/Mail\/[A-Za-z]+\?([A-Za-z0-9]+)/.exec(html);
  return m ? (m[1] as string) : null;
}

export interface LogFile {
  /** Button label, e.g. "Node Debug Log". */
  label: string;
  /** Submit-button name the node reads to pick the file, e.g. "NodeDebug". */
  param: string;
}

/**
 * The node has no log directory page. Its menu holds a View Logs form with one submit
 * button per log kind; each button is one LogFile. A date picks the day.
 */
export function parseLogList(html: string): LogFile[] {
  const d = doc(html);
  const form = Array.from(d.forms).find((f) => /ShowLog/i.test(f.getAttribute('action') ?? ''));
  if (!form) throw new ParseError('Node menu', 'View Logs form');
  const files = Array.from(form.querySelectorAll<HTMLInputElement>('input[type=submit][name]')).map((b) => ({
    label: b.value,
    param: b.name,
  }));
  if (files.length === 0) throw new ParseError('Node menu', 'log buttons');
  return files;
}

/** The log text sits in the page's textarea. */
export function parseLogText(html: string): string {
  const area = doc(html).querySelector('textarea#log');
  if (!area) throw new ParseError('Log', 'log text');
  return (area as HTMLTextAreaElement).value;
}

/** Fetch one day's log (sysop only; throws NotAuthorizedError when signed out). */
export async function fetchLog(file: LogFile, isoDate: string): Promise<string> {
  const url = `/node/ShowLog.html?date=${isoDate}&${file.param}=${encodeURIComponent(file.label).replace(/%20/g, '+')}`;
  return parseLogText(await getProtected(url));
}

export const fetchStats = async (): Promise<Stats> => parseStats(await getText('/Node/Stats.html'));
export const fetchRoutes = async (): Promise<Route[]> => parseRoutes(await getText('/Node/Routes.html'));
