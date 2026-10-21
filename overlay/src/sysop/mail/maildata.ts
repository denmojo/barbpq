// Reads and saves for the mail screens. The old mail pages are fetched as data and their forms
// re-posted to the same handlers with the same fields; nothing here shows or links an old page.
import { parseForm, submitForm, type FormSpec } from '../../data/forms';
import { getJson, getText, HttpError, ParseError } from '../../data/http';
import { assertAuthorized, getProtected, mailKey, withSysop } from '../../data/session';
import { exclusive, parseFwdList, postMail } from '../model';
import type { PipePage } from './fieldmaps';

/** Mail pages whose settings save as an ordinary form post, and the handler each posts to. */
export type FormPage = 'Conf' | 'Wel' | 'HK' | 'FWD';

const FORM_TITLE: Record<FormPage, string> = {
  Conf: 'Mail configuration', Wel: 'Welcome messages', HK: 'Housekeeping', FWD: 'Forwarding',
};

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
export function saveFormPage(page: FormPage, values: Record<string, string>, button: [string, string] = SUBMIT[page]): Promise<FormSpec> {
  return withSysop(async () => {
    const spec = await readForm(page);
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

async function pick(kind: PipePage, call: string): Promise<FormSpec> {
  const html = await postMail(RECORD[kind].details, call);
  const got = recordCall(kind, html);
  if (got === null) throw new ParseError(`${RECORD[kind].title} ${call}`, 'record');
  if (got.toUpperCase() !== call.toUpperCase()) throw new ParseError(`${RECORD[kind].title} ${call}`, `record (the node sent ${got})`);
  return parseForm(html);
}

/** One record's form. Picking it also makes it the node session's current record. */
export function loadRecord(kind: PipePage, call: string): Promise<FormSpec> {
  return withSysop(() => exclusive(() => pick(kind, call)));
}

/** The old pages' script sends the record with XMLHttpRequest, which encodes text as UTF-8. */
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * Save one record: pick it (the node saves to the session's current record), build the body
 * from the freshly read form, post it, and check the reply is that record.
 */
export function saveRecord(kind: PipePage, call: string, body: (spec: FormSpec) => string): Promise<FormSpec> {
  return withSysop(() => exclusive(async () => {
    const spec = await pick(kind, call);
    const reply = await postMail(RECORD[kind].save, utf8(body(spec)));
    const got = recordCall(kind, reply);
    if (got === null || got.toUpperCase() !== call.toUpperCase()) {
      throw new ParseError(`${RECORD[kind].title} ${call} reply`, got ? `saved record (the node answered for ${got})` : 'saved record');
    }
    return parseForm(reply);
  }));
}

/** Add a BBS user. The node answers with the user list, which then holds the new call. */
export function addUser(call: string): Promise<string[]> {
  return withSysop(async () => parseFwdList(await postMail(RECORD.user.save, utf8(`Add=${call}`))));
}

/** Delete a BBS user or a WP record: pick it, then send the old page's "Delete". */
export function deleteRecord(kind: 'user' | 'wp', call: string): Promise<void> {
  return withSysop(() => exclusive(async () => {
    await pick(kind, call);
    await postMail(RECORD[kind].save, utf8('Delete'));
  }));
}

// ---------- the message list (Mail API, GET only) ----------

export interface MailMessage {
  id: number;
  bid: string;
  /** Unix seconds the message was created. */
  created: number;
  type: string;
  status: string;
  to: string;
  from: string;
  size: number;
  subject: string;
}

export interface MessageList {
  msgs: MailMessage[];
  /**
   * The API answers each token as its sign-in allows. A token the node does not take for the
   * sysop gets only the messages that user may read, so the list cannot give BBS-wide counts.
   */
  sysopScope: boolean;
}

interface ApiMsg { id: string; mid: string; rcvd: string; type: string; status: string; to: string; from: string; size: string; subject: string }

/** The API escapes & < > " ' in subjects for XML. */
const unxml = (s: string): string =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_m, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e] ?? _m);

export function parseMessages(json: unknown): MailMessage[] {
  const msgs = (json as { msgs?: unknown }).msgs;
  if (!Array.isArray(msgs)) throw new ParseError('Mail API message list', 'msgs');
  return (msgs as ApiMsg[]).map((m, i) => {
    const id = Number(m.id);
    if (!m || Number.isNaN(id) || typeof m.status !== 'string') throw new ParseError('Mail API message list', `message ${i + 1}`);
    return {
      id, bid: m.mid, created: Number(m.rcvd), type: m.type, status: m.status,
      to: m.to, from: m.from, size: Number(m.size), subject: unxml(m.subject ?? ''),
    };
  });
}

/**
 * Sign in to the Mail API with the mail session key (it issues the key back as the token),
 * read the list, and ask a sysop-only endpoint whether the token counts as sysop.
 */
export function fetchMessages(): Promise<MessageList> {
  return withSysop(async () => {
    const key = await mailKey();
    await getJson(`/mail/api/v1/login?${key}`);
    const msgs = parseMessages(await getJson(`/Mail/API/v1/msgs?${key}`));
    let sysopScope = true;
    try {
      await getJson(`/Mail/API/v1/FwdQLen?${key}`);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 403)) throw e;
      sysopScope = false;
    }
    return { msgs, sysopScope };
  });
}
