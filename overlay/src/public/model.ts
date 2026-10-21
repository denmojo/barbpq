// Pure helpers that turn station, link-state and heard data into what the public screens show.
import { getHeard, getStation } from '../data/uiapi';
import type { Heard, LinkState, Station, StationPort } from '../data/uiapi';
import type { Tone } from '../ui/StatusPill';
import { formatFreq, joinAnd, modeName } from '../ui/format';

/** Winlink ports (those with a frequency) first, each group in the node's port order. */
export function sortPorts(ports: StationPort[]): StationPort[] {
  return [...ports.filter((p) => p.freqHz !== null), ...ports.filter((p) => p.freqHz === null)];
}

/** An AXIP port carries AX.25 over the internet. Matched as LinBPQ picks the driver
 *  (LinBPQ.c:2012-2021): the DLL name upper-cased, with BPQAXIP anywhere in it. */
export const isInternetLink = (p: StationPort): boolean => p.driver.toUpperCase().includes('BPQAXIP');

/** Every port but the internet links, Winlink ports first. */
export const radioPorts = (ports: StationPort[]): StationPort[] => sortPorts(ports.filter((p) => !isInternetLink(p)));

/** The internet links, in the node's port order. */
export const internetLinks = (ports: StationPort[]): StationPort[] => ports.filter(isInternetLink);

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

export interface Hero {
  tone: Tone; title: string; sub: string | null; reason?: string;
  /** A second line under sub: the frequency line when sub carries the down ports' details. */
  sub2?: string;
}

/** The status line at the top of Overview. It says "on the air" only when a radio port is linked;
 *  internet links never count. */
export function heroStatus(
  station: Station | undefined, links: LinkState[] | undefined,
  errors: { station?: Error; links?: Error } = {},
): Hero {
  if (!station) {
    return errors.station
      ? { tone: 'idle', title: 'Status unknown', sub: null, reason: errors.station.message }
      : { tone: 'idle', title: 'Checking the node', sub: null };
  }
  const radio = station.ports.filter((p) => !isInternetLink(p));
  const rf = radio.filter((p) => p.freqHz !== null);
  const what = rf.length ? 'Gateway' : 'Node';
  let sub: string | null = null;
  if (rf.length) {
    const freqs = [...new Set(rf.map((p) => formatFreq(p.freqHz as number)))];
    const modes = [...new Set(rf.flatMap((p) => p.modes.map(modeName)))];
    sub = `Winlink RMS on ${joinAnd(freqs)}${modes.length ? ` · ${joinAnd(modes)}` : ''}`;
  }
  if (!links) {
    return errors.links
      ? { tone: 'idle', title: `${what} status unknown`, sub, reason: errors.links.message }
      : { tone: 'idle', title: `Checking the ${what.toLowerCase()}`, sub };
  }
  const watched = (rf.length ? rf : radio).map((p) => links.find((l) => l.number === p.number));
  const states = watched.map((l) => l?.state ?? 'unknown');
  if (states.includes('linked')) return { tone: 'ok', title: `${what} on the air`, sub };
  if (states.length && states.every((s) => s === 'down')) {
    // Each down port's own words, in port order, said once each; the frequency line moves under them.
    const details = [...new Set(watched.map((l) => l?.detail.trim() ?? '').filter(Boolean))].join(' · ');
    const title = `${what} down: radios not connected`;
    if (!details) return { tone: 'down', title, sub };
    return { tone: 'down', title, sub: details, ...(sub ? { sub2: sub } : {}) };
  }
  return { tone: 'idle', title: `${what} status unknown`, sub };
}

export interface HeardRow extends Heard { port: StationPort }

/** Newest first; an entry with no time goes last. */
export function sortHeard(rows: HeardRow[]): HeardRow[] {
  const t = (r: HeardRow): number => (r.lastHeard ? Date.parse(r.lastHeard) : -Infinity);
  return [...rows].sort((a, b) => t(b) - t(a));
}

/** Heard lists of the given ports, merged newest first. */
export async function loadHeardFor(ports: StationPort[]): Promise<HeardRow[]> {
  const lists = await Promise.all(ports.map(async (port) =>
    (await getHeard(port.number)).map((h) => ({ ...h, port }))));
  return sortHeard(lists.flat());
}

/** The station's ports and their heard lists, for a screen that has no station poll of its own. */
export async function loadHeard(): Promise<{ ports: StationPort[]; rows: HeardRow[] }> {
  const station = await getStation();
  return { ports: station.ports, rows: await loadHeardFor(station.ports) };
}

/** A port's link chip from the link-state poll; null while it is still loading. */
export function linkPillFrom(links: { data?: LinkState[]; error?: Error }, port: number): Pill | null {
  if (links.data) return linkPill(links.data.find((l) => l.number === port));
  if (links.error) return { tone: 'idle', label: 'Unknown', title: links.error.message };
  return null;
}

export const viaText = (via: string[]): string => (via.length ? `via ${via.join(', ')}` : '');
