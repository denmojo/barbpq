// Readers for the sysop screens: the mail Status page, the forwarding records, the RMS
// connect script, and the event log. Pure parsers are kept apart from the fetchers.
import { getText, latin1Bytes, postBody, ParseError } from '../data/http';
import { parseForm } from '../data/forms';
import { assertAuthorized, currentMailKey, getProtected, mailKey, MailSessionLostError, withSysop } from '../data/session';
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

/** POST to a mail handler with the session key. A string body goes as ISO-8859-1. Not for use inside a job: see MailJob. */
export async function postMail(path: string, body: string | Uint8Array): Promise<string> {
  const bytes = typeof body === 'string' ? latin1Bytes(body) : body;
  const key = await mailKey();
  return assertAuthorized(await postBody(`/Mail/${path}?${key}`, bytes), key);
}

/**
 * The node lost the mail session while a pick-then-save job was running, so the record the job
 * picked is gone with it. Nothing more was sent; the job is not retried on a fresh key, because
 * a fresh node session has no current record and MsgSave, FWDSave and UserSave on it crash the
 * node (BBSHTMLConfig.c ProcessMsgUpdate, SaveFwdDetails, ProcessUserUpdate read it unchecked).
 */
export class MailJobAbortedError extends Error {
  constructor(what: string) {
    super(`The node dropped the mail session during ${what}, so nothing more was sent. Run it again.`);
    this.name = 'MailJobAbortedError';
  }
}

/**
 * The job's write was sent and the node answered it, then the mail session was lost before the
 * result could be read back. What the node holds now is not known, so the view needs a reload;
 * running the action again is not the advice, because the write may already have been made.
 */
export class MailWriteUnconfirmedError extends Error {
  constructor(what: string) {
    super(`The write for ${what} was sent and the node answered it, but the mail session was dropped before the result could be read back. Reload the view to see what the node holds.`);
    this.name = 'MailWriteUnconfirmedError';
  }
}

/**
 * One exclusive job's view of the mail session: every request goes out on the key the job
 * started with. Before each request the job checks that key is still the one this browser
 * holds; a lost-session reply, or a key that changed under it (another request found the
 * session lost and a fresh one was handed out), aborts the job with nothing more sent.
 */
export interface MailJob {
  readonly key: string;
  /** POST to /Mail/<path>?<key>. */
  post(path: string, body: string | Uint8Array): Promise<string>;
  /** GET /Mail/<path>?<key><suffix>. */
  get(path: string, suffix?: string): Promise<string>;
  /** Throw MailJobAbortedError now if the key changed under the job. */
  check(): void;
  /** Check a reply that came back on this job's key. */
  accept(html: string): string;
}

function makeJob(key: string, what: string): MailJob {
  const job: MailJob = {
    key,
    check() {
      if (currentMailKey() !== key) throw new MailJobAbortedError(what);
    },
    accept(html) {
      try {
        return assertAuthorized(html, key);
      } catch (e) {
        if (e instanceof MailSessionLostError) throw new MailJobAbortedError(what);
        throw e;
      }
    },
    async post(path, body) {
      job.check();
      const bytes = typeof body === 'string' ? latin1Bytes(body) : body;
      return job.accept(await postBody(`/Mail/${path}?${key}`, bytes));
    },
    async get(path, suffix = '') {
      job.check();
      return job.accept(await getText(`/Mail/${path}?${key}${suffix}`));
    },
  };
  return job;
}

let mailQueue: Promise<unknown> = Promise.resolve();

/**
 * Run fn alone among the mail requests that pick a record. FwdDetails, UserDetails, WPDetails
 * and MsgDetails set the node session's current record, and FWDSave, UserSave, WPSave and
 * MsgSave write to whichever record that is, so a pick and its save must not interleave with
 * another pick, and must go to the same node session: fn gets a MailJob pinned to one key.
 */
export function exclusive<T>(fn: (job: MailJob) => Promise<T>, what = 'this change'): Promise<T> {
  const start = async (): Promise<T> => fn(makeJob(await mailKey(), what));
  const run = mailQueue.then(start, start);
  mailQueue = run.catch(() => undefined);
  return run;
}

export async function fetchForwarding(): Promise<Forwarding> {
  // The list read and the FwdDetails POST are one job: a partner removed (or re-added without
  // forwarding info) between them would send the node down its NULL ForwardingInfo path.
  return withSysop(() => exclusive(async (job) => {
    const partners = parseFwdList(await job.post('FwdList.txt', ''));
    const call = partners.find((p) => p.toUpperCase() === RMS);
    const rms = call ? parseFwdDetails(await job.post('FwdDetails', call), call) : null;
    return { partners, rms };
  }));
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

/** How many events the store-and-forward card searches for the last fallback run. */
export const EVENT_WINDOW = 200;

export interface StoreForward {
  tone: Tone; value: string; meta: string; reason?: string;
  /** Set when the last-used line is unknown; the card shows Unknown with this reason. */
  metaUnknown?: string;
}

/**
 * A forward run to the RMS record. The node logs a run to any partner, routed as "<partner call>"
 * or "<partner call> via port N"; a run to another partner may have taken the result of someone
 * else's CMS attempt, so it says nothing about the RMS fallback.
 */
export function isRunTo(e: UiEvent, call: string): boolean {
  const route = e.detail.route;
  return e.kind === 'forward' && typeof route === 'string' && (route.split(' ')[0] ?? '').toUpperCase() === call.toUpperCase();
}

/** The newest run to the RMS record whose own CMS attempt failed (the node logs each run after that attempt). Events arrive newest first. */
export function lastFallback(events: UiEvent[], call: string = RMS): UiEvent | undefined {
  return events.find((e) => isRunTo(e, call) && e.detail.cmsReachable === false);
}

/**
 * The newest run to the RMS record that the node logged with no CMS result (null: none came
 * within its wait), when it is newer than the last fallback. Such a run may have fallen back,
 * so it leaves "Never used" or the last-used date unknown. Only a later fallback settles it;
 * a later run that reached the CMS says nothing about the earlier one.
 */
export function undecidedRun(events: UiEvent[], call: string = RMS): UiEvent | undefined {
  for (const e of events) {
    if (!isRunTo(e, call)) continue;
    if (e.detail.cmsReachable === false) return undefined;
    if (e.detail.cmsReachable === null) return e;
  }
  return undefined;
}

/** Armed when the RMS record forwards; last used from the newest RMS run with the CMS unreachable. */
export function storeForward(fwd: Forwarding, events: UiEvent[] | undefined): StoreForward {
  if (!fwd.rms) return { tone: 'idle', value: 'Not set up', meta: 'No RMS forwarding record on the BBS' };
  const call = fwd.rms.call;
  const used = events ? lastFallback(events, call) : undefined;
  const open = events ? undecidedRun(events, call) : undefined;
  // A full window with no fallback says nothing about the events before it.
  const cut = events !== undefined && !used && events.length >= EVENT_WINDOW;
  const unknownWhy = open
    ? `The ${call} run at ${formatStamp(open.t)} logged no CMS result within the node's wait, so whether it fell back is not known`
    : cut ? `No fallback in the last ${EVENT_WINDOW} events` : undefined;
  const meta = events === undefined || unknownWhy ? '' : used ? `Last used ${formatStamp(used.t)}` : 'Never used';
  const unknown = unknownWhy ? { metaUnknown: unknownWhy } : {};
  if (!fwd.rms.enabled) return { tone: 'down', value: 'Off', meta, reason: 'Forwarding is not enabled on the RMS record', ...unknown };
  return { tone: used ? 'ok' : 'warn', value: 'Armed', meta, ...unknown };
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
