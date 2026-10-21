// Display formatting shared by the screens. Times are shown in the browser's local zone.
import type { LinkEvidence } from '../data/uiapi';

const pad = (n: number): string => String(n).padStart(2, '0');

export function formatFreq(hz: number): string {
  return `${(hz / 1e6).toFixed(3)} MHz`;
}

/** "2d 04:17"; under a day "0d 00:08". */
export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${pad(h)}:${pad(m)}`;
}

/** Local 24-hour clock, "09:12". */
export function formatClock(t: string | Date): string {
  const d = typeof t === 'string' ? new Date(t) : t;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local date and time, "Oct 20 09:12". */
export function formatStamp(t: string): string {
  const d = new Date(t);
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${month} ${d.getDate()} ${formatClock(d)}`;
}

/** Age in the largest whole unit: now, 4m, 3h, 2d. */
export function formatAgo(t: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.floor((now.getTime() - new Date(t).getTime()) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const MODES: Record<string, string> = {
  VARAFM96: 'VARA FM', VARAFM48: 'VARA FM', VARAFM: 'VARA FM',
  VARA500: 'VARA HF', VARA2300: 'VARA HF', VARA2750: 'VARA HF', VARAHF: 'VARA HF',
  PKT1200: '1200 baud packet', PKT2400: '2400 baud packet', PKT4800: '4800 baud packet', PKT9600: '9600 baud packet',
  PKT19200: '19200 baud packet', ARDOP: 'ARDOP', PACTOR: 'Pactor',
};

/** Winlink mode code (WL2KREPORT) as words; an unlisted code is shown as the node gives it. */
export function modeName(code: string): string {
  return MODES[code] ?? code;
}

/** "a", "a and b", "a, b and c" */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A linked port's label from the node's evidence, the same on every screen: an open serial device
 *  is Device open, an AXIP socket Linked, an observed radio link (or a node that sends no evidence)
 *  Listening. */
export function linkedLabel(evidence: LinkEvidence | null | undefined): string {
  if (evidence === 'device') return 'Device open';
  if (evidence === 'socket') return 'Linked';
  return 'Listening';
}
