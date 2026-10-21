// Pure helpers that turn station, link-state and heard data into what the public screens show.
import { getHeard, getStation } from '../data/uiapi';
import type { Heard, LinkState, Station, StationPort } from '../data/uiapi';
import type { Tone } from '../ui/StatusPill';
import { formatFreq, joinAnd, modeName } from '../ui/format';

/** Radio ports (those with a Winlink frequency) first, each group in the node's port order. */
export function sortPorts(ports: StationPort[]): StationPort[] {
  return [...ports.filter((p) => p.freqHz !== null), ...ports.filter((p) => p.freqHz === null)];
}

function addrLabel(p: StationPort): string {
  if (p.driver === 'VARA') return 'TNC';
  if (p.driver === 'KISS') return 'KISS';
  return p.driver;
}

/** The mono line under a port name: frequency, modes, address, TXTAIL. Parts the node did not report are left out. */
export function portMeta(p: StationPort, telnetPort: number | null): string {
  const parts: string[] = [];
  if (p.freqHz !== null) parts.push(formatFreq(p.freqHz));
  parts.push(...p.modes);
  if (p.driver === 'TELNET') parts.push(telnetPort !== null ? `Telnet :${telnetPort}` : 'Telnet');
  else if (p.addr) parts.push(`${addrLabel(p)} ${p.addr}`);
  else parts.push(p.driver);
  if (p.txtailMs !== null) parts.push(`TXTAIL ${p.txtailMs} ms`);
  return parts.join(' · ');
}

export interface Pill { tone: Tone; label: string; title: string }

/** Link state as a chip. "unknown" and a port the node left out are Unknown, never Listening. */
export function linkPill(state: LinkState | undefined): Pill {
  if (!state) return { tone: 'idle', label: 'Unknown', title: 'The node has not reported a link state for this port' };
  if (state.state === 'linked') return { tone: 'ok', label: 'Listening', title: state.detail };
  if (state.state === 'down') return { tone: 'down', label: 'Down', title: state.detail };
  return { tone: 'idle', label: 'Unknown', title: state.detail };
}

export interface Hero { tone: Tone; title: string; sub: string | null }

/** The status line at the top of Overview. It says "on the air" only when a radio port is linked. */
export function heroStatus(station: Station | undefined, links: LinkState[] | undefined): Hero {
  if (!station) return { tone: 'idle', title: 'Checking the node', sub: null };
  const rf = station.ports.filter((p) => p.freqHz !== null);
  const what = rf.length ? 'Gateway' : 'Node';
  let sub: string | null = null;
  if (rf.length) {
    const freqs = [...new Set(rf.map((p) => formatFreq(p.freqHz as number)))];
    const modes = [...new Set(rf.flatMap((p) => p.modes.map(modeName)))];
    sub = `Winlink RMS on ${joinAnd(freqs)}${modes.length ? ` · ${joinAnd(modes)}` : ''}`;
  }
  if (!links) return { tone: 'idle', title: `${what} status loading`, sub };
  const states = (rf.length ? rf : station.ports).map((p) => links.find((l) => l.number === p.number)?.state ?? 'unknown');
  if (states.includes('linked')) return { tone: 'ok', title: `${what} on the air`, sub };
  if (states.length && states.every((s) => s === 'down')) return { tone: 'down', title: `${what} off the air`, sub };
  return { tone: 'idle', title: `${what} status unknown`, sub };
}

export interface HeardRow extends Heard { port: StationPort }

/** Newest first; an entry with no time goes last. */
export function sortHeard(rows: HeardRow[]): HeardRow[] {
  const t = (r: HeardRow): number => (r.lastHeard ? Date.parse(r.lastHeard) : -Infinity);
  return [...rows].sort((a, b) => t(b) - t(a));
}

/** Heard lists of every port, merged. */
export async function loadHeard(): Promise<{ ports: StationPort[]; rows: HeardRow[] }> {
  const station = await getStation();
  const lists = await Promise.all(station.ports.map(async (port) =>
    (await getHeard(port.number)).map((h) => ({ ...h, port }))));
  return { ports: station.ports, rows: sortHeard(lists.flat()) };
}

export const viaText = (via: string[]): string => (via.length ? `via ${via.join(', ')}` : '');
