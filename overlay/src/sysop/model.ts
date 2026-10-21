// Readers for the sysop screens: the mail Status page, the forwarding records, the RMS
// connect script, and the event log. Pure parsers are kept apart from the fetchers.
import { latin1Bytes, postBody, ParseError } from '../data/http';
import { parseForm } from '../data/forms';
import { assertAuthorized, getProtected, mailKey, withSysop } from '../data/session';
import type { LinkState, StationPort, UiEvent } from '../data/uiapi';
import type { Tone } from '../ui/StatusPill';
import { formatClock, formatStamp } from '../ui/format';

const nbsp = (s: string | null | undefined): string => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export interface MailStatus {
  /** BBS call from the page heading, "BPQ32 BBS AD6DM". */
  bbs: string | null;
  /** Streams that are not Idle (signed-in users and logins in progress). */
  users: number;
  msgs: number;
  sysopMsgs: number;
  held: number;
  smtp: number;
}

/** The mail Status page: heading, one select option per BBS stream, then four read-only counters. */
export function parseMailStatus(html: string): MailStatus {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const heading = Array.from(d.querySelectorAll('h3')).map((h) => nbsp(h.textContent)).find((t) => /^BPQ32 BBS /.test(t));
  const select = d.querySelector('select[name=call]');
  if (!select) throw new ParseError('Mail Status', 'stream list');
  const users = Array.from(select.querySelectorAll('option')).filter((o) => !/^Idle\b/.test(nbsp(o.textContent))).length;
  const counters = new Map<string, number>();
  for (const input of Array.from(d.querySelectorAll('input[readonly]'))) {
    const label = nbsp(input.previousSibling?.textContent);
    const n = Number((input as HTMLInputElement).getAttribute('value'));
    if (label && !Number.isNaN(n)) counters.set(label, n);
  }
  const count = (label: string): number => {
    const n = counters.get(label);
    if (n === undefined) throw new ParseError('Mail Status', label);
    return n;
  };
  return {
    bbs: heading ? heading.replace(/^BPQ32 BBS /, '') : null,
    users,
    msgs: count('Msgs'),
    sysopMsgs: count('Sysop Msgs'),
    held: count('Held Msgs'),
    smtp: count('SMTP Msgs'),
  };
}

export async function fetchMailStatus(): Promise<MailStatus> {
  return withSysop(async () => parseMailStatus(await getProtected(`/Mail/Status?${await mailKey()}`)));
}

/** FwdList.txt: the forwarding partners as "AD6DM|RMS|", followed by stray closing tags. */
export function parseFwdList(text: string): string[] {
  const parts = text.split('|');
  parts.pop();
  return parts.map((p) => p.trim()).filter(Boolean);
}

export interface FwdRecord {
  call: string;
  enabled: boolean;
  /** Connect script lines, as in the form's textarea. */
  script: string;
  /** Poll interval in seconds; null when the field is blank or not a number. */
  intervalSec: number | null;
  /** "Send new messages without waiting for poll timer". */
  sendAtOnce: boolean;
  /** From the heading "Forwarding Config for RMS - 0 Messages Queued". */
  queued: number | null;
}

/** One partner's forwarding form (FwdDetails), read with parseForm. */
export function parseFwdDetails(html: string, call: string): FwdRecord {
  const spec = parseForm(html);
  const field = (name: string) => spec.fields.find((f) => f.name === name);
  const fwd = field('FWD');
  const enf = field('EnF');
  if (!fwd) throw new ParseError(`Forwarding for ${call}`, 'Connect Script');
  if (!enf) throw new ParseError(`Forwarding for ${call}`, 'Enable Forwarding');
  const interval = Number(field('Interval')?.value ?? '');
  const queued = /(\d+) Messages Queued/.exec(html);
  return {
    call,
    enabled: !!enf.checked,
    script: fwd.value,
    intervalSec: field('Interval')?.value && !Number.isNaN(interval) ? interval : null,
    sendAtOnce: !!field('NoWait')?.checked,
    queued: queued ? Number(queued[1]) : null,
  };
}

export interface Forwarding {
  partners: string[];
  /** The RMS forwarding record, or null when the BBS has none. */
  rms: FwdRecord | null;
}

export const RMS = 'RMS';

async function postMail(path: string, body: string): Promise<string> {
  return assertAuthorized(await postBody(`/Mail/${path}?${await mailKey()}`, latin1Bytes(body)));
}

export async function fetchForwarding(): Promise<Forwarding> {
  return withSysop(async () => {
    const partners = parseFwdList(await postMail('FwdList.txt', ''));
    const call = partners.find((p) => p.toUpperCase() === RMS);
    const rms = call ? parseFwdDetails(await postMail('FwdDetails', call), call) : null;
    return { partners, rms };
  });
}

export interface RouteStep {
  /** 'cms' for the Telnet driver's CMS connect, else the call connected to. */
  kind: 'cms' | 'call';
  label: string;
  /** The radio or Telnet port the connect goes out on; null when the node routes it. */
  port: number | null;
}

/**
 * The tries in a connect script, in order. Lines are split on newlines (the form) or '|'
 * (bpq32.cfg). ELSE starts the next alternative; ATTACH n sets the port for a bare
 * "C CMS"; "C n CALL" connects on port n; other commands do not change the route.
 */
export function parseConnectScript(script: string): RouteStep[] {
  const steps: RouteStep[] = [];
  let attached: number | null = null;
  let done = false;
  for (const raw of script.split(/\r?\n|\|/)) {
    const line = raw.trim();
    if (!line) continue;
    const words = line.split(/\s+/);
    const cmd = (words[0] ?? '').toUpperCase();
    if (cmd === 'ELSE') {
      attached = null;
      done = false;
      continue;
    }
    if (cmd === 'ATTACH' && words[1] && /^\d+$/.test(words[1])) {
      attached = Number(words[1]);
      continue;
    }
    if ((cmd === 'C' || cmd === 'CONNECT') && !done && words.length > 1) {
      const rest = words.slice(1);
      let port: number | null = attached;
      if (rest.length > 1 && /^\d+$/.test(rest[0] as string)) port = Number(rest.shift());
      const target = (rest[0] as string).toUpperCase();
      steps.push(target === 'CMS' ? { kind: 'cms', label: 'CMS via internet', port } : { kind: 'call', label: target, port });
      done = true;
    }
  }
  return steps;
}

/** "Telnet port 1", "Packet port 2", "VARA port 3". */
export function portLabel(port: number | null, ports: StationPort[] | undefined): string {
  if (port === null) return 'Routed by the node';
  const p = ports?.find((x) => x.number === port);
  if (!p) return `Port ${port}`;
  const kind = p.driver === 'TELNET' ? 'Telnet' : p.driver === 'KISS' ? 'Packet' : p.driver === 'VARA' ? 'VARA' : p.id || p.driver;
  return `${kind} port ${port}`;
}

/** "Every 30 min while mail is held · sends new mail at once" from the RMS record. */
export function scheduleNote(r: FwdRecord): string {
  const parts: string[] = [];
  if (r.intervalSec !== null && r.intervalSec > 0) {
    const s = r.intervalSec;
    parts.push(`Every ${s % 60 === 0 ? `${s / 60} min` : `${s} s`} while mail is held`);
  }
  if (r.sendAtOnce) parts.push('sends new mail at once');
  return parts.join(' · ');
}

/** Today's events show a clock time, older ones the date. */
export function eventTime(t: string, now: Date = new Date()): string {
  const d = new Date(t);
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? formatClock(d) : formatStamp(t).split(' ').slice(0, 2).join(' ');
}

export interface StoreForward { tone: Tone; value: string; meta: string; reason?: string }

/** The newest forward event that ran while the CMS was unreachable. Events arrive newest first. */
export function lastFallback(events: UiEvent[]): UiEvent | undefined {
  return events.find((e) => e.kind === 'forward' && e.detail.cmsReachable === false);
}

/** Armed when the RMS record forwards; last used from the newest forward with the CMS unreachable. */
export function storeForward(fwd: Forwarding, events: UiEvent[] | undefined): StoreForward {
  if (!fwd.rms) return { tone: 'idle', value: 'Not set up', meta: 'No RMS forwarding record on the BBS' };
  const used = events ? lastFallback(events) : undefined;
  const meta = events === undefined ? '' : used ? `Last used ${formatStamp(used.t)}` : 'Never used';
  if (!fwd.rms.enabled) return { tone: 'down', value: 'Off', meta, reason: 'Forwarding is not enabled on the RMS record' };
  return { tone: used ? 'ok' : 'warn', value: 'Armed', meta };
}

/** A link state as the health card shows it. */
export function linkValue(s: LinkState | undefined): { tone: Tone; value: string | null; reason: string } {
  if (!s) return { tone: 'idle', value: null, reason: 'The node has not reported a link state for this port' };
  if (s.state === 'linked') return { tone: 'ok', value: 'Linked', reason: s.detail };
  if (s.state === 'down') return { tone: 'down', value: 'Down', reason: s.detail };
  return { tone: 'idle', value: null, reason: s.detail };
}

/** ":8300" for a modem on this machine, else the address as given. */
export function shortAddr(addr: string | null): string | null {
  if (!addr) return null;
  const m = /^(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)$/.exec(addr);
  return m ? `:${m[1]}` : addr;
}
