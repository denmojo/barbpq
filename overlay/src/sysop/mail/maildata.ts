// Reads and saves for the mail screens. The old mail pages are fetched as data and their forms
// re-posted to the same handlers with the same fields; nothing here shows or links an old page.
import { parseForm, submitForm, type FormSpec } from '../../data/forms';
import { getText, ParseError } from '../../data/http';
import { assertAuthorized, getProtected, mailKey, withSysop } from '../../data/session';
import { exclusive, parseFwdDetails, parseFwdList, postMail, type FwdRecord, type MailJob } from '../model';
import { sendOnce, type Outcome } from './sendonce';
import type { PipePage } from './fieldmaps';
import { changedOnNode } from './mailform';

/** Mail pages whose settings save as an ordinary form post, and the handler each posts to. */
export type FormPage = 'Conf' | 'Wel' | 'HK' | 'FWD';

const FORM_TITLE: Record<FormPage, string> = {
  Conf: 'Mail configuration', Wel: 'Welcome messages', HK: 'Housekeeping', FWD: 'Forwarding',
};

/** The form the draft was made on and the keys the sysop edited, for the lost-update check. */
export interface SaveGuard { loaded: FormSpec; edited: string[] }

/** The node's copy changed since the sysop opened it; posting would write the old values back. */
export class ChangedOnNodeError extends Error {
  constructor() {
    super('Changed on the node since you opened it; reload to see it');
    this.name = 'ChangedOnNodeError';
  }
}

function checkGuard(guard: SaveGuard | undefined, fresh: FormSpec): void {
  if (guard && changedOnNode(guard.loaded, fresh, guard.edited)) throw new ChangedOnNodeError();
}

async function readForm(page: FormPage): Promise<FormSpec> {
  const url = `/Mail/${page}?${await mailKey()}`;
  return parseForm(await getProtected(url), 0, url);
}

export function loadFormPage(page: FormPage): Promise<FormSpec> {
  return withSysop(() => readForm(page));
}

/** The pressed button, as the old page posts it: Save=Save on most pages, Submit=Update on FWD. */
const SUBMIT: Record<FormPage, [string, string]> = {
  Conf: ['Save', 'Save'], Wel: ['Save', 'Save'], HK: ['Save', 'Save'], FWD: ['Submit', 'Update'],
};

/**
 * Post the form with the edited values. The page is read again first, so the action carries
 * the current session key and an untouched password goes as the node has it now. The node
 * answers with the page itself; its form is the saved state.
 */
export function saveFormPage(
  page: FormPage, values: Record<string, string>, guard?: SaveGuard, button: [string, string] = SUBMIT[page],
): Promise<FormSpec> {
  return withSysop(async () => {
    const spec = await readForm(page);
    checkGuard(guard, spec);
    const reply = await submitForm(spec, { ...values, [button[0]]: button[1] });
    try {
      const after = parseForm(reply, 0, spec.action);
      if (after.action !== spec.action) throw new ParseError(FORM_TITLE[page], 'saved form');
      return after;
    } catch {
      throw new ParseError(`${FORM_TITLE[page]} reply`, 'saved settings');
    }
  });
}

// ---------- record pages: forwarding partners, BBS users, white pages ----------

const RECORD = {
  fwd: { list: 'FwdList.txt', details: 'FwdDetails', save: 'FWDSave', title: 'Forwarding' },
  user: { list: 'UserList.txt', details: 'UserDetails', save: 'UserSave', title: 'BBS user' },
  wp: { list: 'WPInfo.txt', details: 'WPDetails', save: 'WPSave', title: 'White pages' },
} as const;

/** The call a record page is for: its heading, or the WP page's read-only call box. */
export function recordCall(kind: PipePage, html: string): string | null {
  const m = kind === 'fwd' ? /Forwarding Config for (\S+)/.exec(html)
    : kind === 'user' ? /Update User (\S+?)</.exec(html)
      : /<input[^>]*readonly[^>]*value="?([^"\s>]+)/i.exec(html);
  return m ? (m[1] as string) : null;
}

/** "AD6DM|RMS|" lists (FwdList.txt, UserList.txt, WPInfo.txt). */
export function listRecords(kind: PipePage): Promise<string[]> {
  return withSysop(async () => {
    // The WP page asks for its list with GET; the others POST.
    const text = kind === 'wp'
      ? assertAuthorized(await getText(`/Mail/${RECORD.wp.list}?${await mailKey()}`))
      : await postMail(RECORD[kind].list, '');
    return parseFwdList(text);
  });
}

async function pick(job: MailJob, kind: PipePage, call: string): Promise<FormSpec> {
  return parseForm(await pickHtml(job, kind, call));
}

/** The picked record's page as the node sent it. */
async function pickHtml(job: MailJob, kind: PipePage, call: string): Promise<string> {
  // FwdDetails for a call that is not a forwarding partner crashes the node (SendFwdDetails
  // reads a NULL ForwardingInfo), so check the partner list first, every time.
  if (kind === 'fwd' && !parseFwdList(await job.post(RECORD.fwd.list, '')).some((p) => p.toUpperCase() === call.toUpperCase())) {
    throw new ParseError('Forwarding partners', `partner ${call}`);
  }
  const html = await job.post(RECORD[kind].details, call);
  const got = recordCall(kind, html);
  if (got === null) throw new ParseError(`${RECORD[kind].title} ${call}`, 'record');
  if (got.toUpperCase() !== call.toUpperCase()) throw new ParseError(`${RECORD[kind].title} ${call}`, `record (the node sent ${got})`);
  return html;
}

/** One record's form. Picking it also makes it the node session's current record. */
export function loadRecord(kind: PipePage, call: string): Promise<FormSpec> {
  return withSysop(() => exclusive((job) => pick(job, kind, call), `opening ${call}`));
}

/** The old pages' script sends the record with XMLHttpRequest, which encodes text as UTF-8. */
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * Save one record: pick it (the node saves to the session's current record), build the body
 * from the freshly read form, post it, and check the reply is that record.
 */
export function saveRecord(kind: PipePage, call: string, body: (spec: FormSpec) => string, guard?: SaveGuard): Promise<FormSpec> {
  return withSysop(() => exclusive(async (job) => {
    const spec = await pick(job, kind, call);
    checkGuard(guard, spec);
    const reply = await job.post(RECORD[kind].save, utf8(body(spec)));
    const got = recordCall(kind, reply);
    if (got === null || got.toUpperCase() !== call.toUpperCase()) {
      throw new ParseError(`${RECORD[kind].title} ${call} reply`, got ? `saved record (the node answered for ${got})` : 'saved record');
    }
    return parseForm(reply);
  }, `the save of ${call}`));
}

/** Add a BBS user. The node answers with the user list, which then holds the new call. */
export function addUser(call: string): Promise<string[]> {
  return withSysop(async () => parseFwdList(await postMail(RECORD.user.save, utf8(`Add=${call}`))));
}

/** What a delete left: the list as the node now has it, and whether the call is gone from it. */
export interface DeleteResult { calls: string[]; gone: boolean }

/**
 * Delete a BBS user or a WP record: pick it, send the old page's "Delete", then read the list
 * again and report whether the call is gone. The delete is sent once: if the session expired as
 * it went, the retry after sign-in only reads the list (the outcome says so).
 */
export function deleteRecord(kind: 'user' | 'wp', call: string): Promise<Outcome<DeleteResult>> {
  const after = async (job: MailJob): Promise<DeleteResult> => {
    const calls = kind === 'wp'
      ? parseFwdList(await job.get(RECORD.wp.list))
      : parseFwdList(await job.post(RECORD.user.list, ''));
    return { calls, gone: !calls.some((c) => c.toUpperCase() === call.toUpperCase()) };
  };
  return sendOnce(async (job, post) => {
    if (kind === 'wp') {
      const calls = (await after(job)).calls;
      if (calls.length === 1 && calls[0]?.toUpperCase() === call.toUpperCase()) throw new LastWpRecordError(call);
    }
    await pick(job, kind, call);
    await post(RECORD[kind].save, utf8('Delete'));
    return after(job);
  }, after, `the delete of ${call}`);
}

/**
 * The node's WP delete frees the record and then makes WPRecPtr[1] the session's current record;
 * when the record deleted was the only one, that pointer is the freed record, and the node's
 * reply (and any later save on that session) reads freed memory. Seen on staging: the reply's
 * call box held garbage. So the last white pages record is not deleted from here.
 */
export class LastWpRecordError extends Error {
  constructor(readonly call: string) {
    super(`${call} is the only white pages record. Deleting the last record makes the node read freed memory (a defect in its WP delete), so it is not deleted from here.`);
    this.name = 'LastWpRecordError';
  }
}

/**
 * Start Forwarding for one partner, as the old page's button does: check the partner list, pick
 * the record (FwdDetails), send "StartForward". The node answers with the partner's record; its
 * heading carries the queue count. Sent once, like a delete.
 */
export function startForwarding(call: string): Promise<Outcome<FwdRecord>> {
  const read = async (job: MailJob): Promise<FwdRecord> => parseFwdDetails(await pickHtml(job, 'fwd', call), call);
  return sendOnce(async (job, post) => {
    await pick(job, 'fwd', call);
    const reply = await post(RECORD.fwd.save, utf8('StartForward'));
    const got = recordCall('fwd', reply);
    if (got === null || got.toUpperCase() !== call.toUpperCase()) {
      throw new ParseError(`Forwarding ${call} reply`, got ? `record (the node answered for ${got})` : 'record');
    }
    return parseFwdDetails(reply, call);
  }, read, `Start Forwarding for ${call}`);
}

// ---------- the message list (the old Msgs page's data) ----------

export interface MailMessage {
  id: number;
  bid: string;
  type: string;
  /** N new, Y read, F forwarded, K killed, H held, D delivered, $ bulletin (MsgInfo.status). */
  status: string;
  to: string;
  from: string;
  via: string;
  size: number;
  subject: string;
  /** As the node prints it, e.g. "20-Oct 23:52Z". */
  sent: string;
}

/** MsgInfo.txt: message numbers newest first, "4|3|2|1|", then stray closing tags. */
export function parseMsgNumbers(text: string): number[] {
  return parseFwdList(text).map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0) throw new ParseError('Message list', `message number "${p}"`);
    return n;
  });
}

/** One MsgDetails reply: the "Message N" heading and the edit form's fields. */
export function parseMsgDetails(html: string, n: number): MailMessage {
  if (!new RegExp(`<h4>Message ${n}</h4>`).test(html)) throw new ParseError(`Message ${n}`, 'record');
  const spec = parseForm(html);
  const v = (name: string): string => {
    const f = spec.fields.find((x) => x.name === name);
    if (!f) throw new ParseError(`Message ${n}`, name);
    return f.value;
  };
  const raw = rawMsgFields(html, n);
  return {
    id: n, bid: raw.bid, type: v('Type'), status: v('Status'), to: raw.to, from: raw.from,
    via: raw.via, size: Number(v('Size')), subject: raw.subject, sent: v('Sent'),
  };
}

/** The text fields MsgSave writes back, as raw text out of the page (one character per byte). */
export interface RawMsgFields { from: string; to: string; bid: string; efrom: string; via: string; subject: string }

/**
 * The node prints these fields into the MsgDetails page as they are stored, with no HTML escaping
 * (MailDetailPage, BBSHTMLConfig.c:287-313): From, To, EFROM and VIA unquoted, BID and Title in
 * quotes. A DOM parser would cut a title at a '"', decode "&amp;", and so on, so the values are
 * cut out of the page text between the template's own fixed neighbours instead. Those bytes are
 * what the node holds, and what a save sends back for a field the sysop did not touch.
 */
const RAW_FIELDS: [keyof RawMsgFields, string, string][] = [
  ['from', 'name=From value=', '> Sent&nbsp;'],
  ['to', 'name=To value=', '> Received&nbsp;'],
  ['bid', 'name=BID value="', '"> Last Changed '],
  ['efrom', 'name=EFROM value=', '><br>&nbsp;VIA&nbsp;'],
  ['via', 'name=VIA value=', '><br>Title&nbsp;'],
  ['subject', 'name=Title value="', '"> <br><br><span align = center>'],
];

export function rawMsgFields(html: string, n: number): RawMsgFields {
  const out = {} as RawMsgFields;
  for (const [k, start, end] of RAW_FIELDS) {
    const a = html.indexOf(start);
    const b = a < 0 ? -1 : html.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new ParseError(`Message ${n}`, `${k} as the node stores it`);
    out[k] = html.slice(a + start.length, b);
  }
  return out;
}

/**
 * Every message, as the old Msgs page reads them: the numbers from MsgInfo.txt (all filters
 * empty), then one MsgDetails per number. MsgDetails sets the session's current message, so
 * the reads run one at a time inside exclusive(). That is one request per message, so the
 * screen reads only when opened and on Refresh.
 */
export interface MessageRead { msgs: MailMessage[]; /** Messages gone between MsgInfo.txt and their MsgDetails. */ changed: number }

/** A message killed and removed after MsgInfo.txt listed it: the node answers MsgDetails with no record. */
const gone = (html: string, n: number): boolean => !new RegExp(`<h4>Message ${n}</h4>`).test(html);

export function fetchMessages(onProgress?: (done: number, total: number, changed: number) => void): Promise<MessageRead> {
  return withSysop(() => exclusive(async (job) => {
    const numbers = parseMsgNumbers(await job.post('MsgInfo.txt', '||||'));
    const msgs: MailMessage[] = [];
    let changed = 0;
    for (const [i, n] of numbers.entries()) {
      onProgress?.(i, numbers.length, changed);
      const html = await job.post('MsgDetails', String(n));
      if (gone(html, n)) changed += 1;
      else msgs.push(parseMsgDetails(html, n));
    }
    return { msgs, changed };
  }, 'the message list read'));
}
