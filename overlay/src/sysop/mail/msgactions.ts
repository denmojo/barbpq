// Per-message work on the BBS, as the old Msgs page does it: MsgDetails picks a message (the
// node keeps it as the session's current message), then MsgSave, MsgFwdUpdate or EditM act on
// whichever message that is. Every pick and the request after it run as one exclusive() job.
//
// Node facts this module leans on (BBSHTMLConfig.c):
//  - MsgDetails for a number with no message answers an empty page and sets the current message
//    to NULL; MsgSave then dereferences it before any check (ProcessMsgUpdate) and EditM reads
//    Session->Msg->number, so both crash the node. Each pick is checked for its heading first.
//  - MsgSave takes "From|To|BID|EmailFrom|VIA|Title|Type|Status|" raw (no form encoding) and
//    strcpy()s each field into fixed buffers, so lengths are checked here. Status K runs
//    FlagAsKilled, which clears the message's forwarding bits, as the old page's Save does.
//  - MsgFwdUpdate steps one partner's cell: none -> queued -> sent -> none. It reads the partner
//    from BBSLIST, which only a GET of /Mail/Msgs refreshes.
import { getText, latin1Bytes, ParseError } from '../../data/http';
import { parseForm } from '../../data/forms';
import { assertAuthorized, mailKey, withSysop } from '../../data/session';
import { exclusive, parseFwdList, postMail } from '../model';
import { ChangedOnNodeError, type MailMessage } from './maildata';
import { sendOnce as once, type Outcome } from './sendonce';

export type { Outcome };

export type FwdState = 'sent' | 'queued' | 'none';
/** One partner cell of the message's forwarding table. */
export interface FwdCell { bbs: number; call: string; state: FwdState }

export interface MessageDetail extends MailMessage {
  rx: string;
  lastChange: string;
  efrom: string;
  /** The node's forwarding table for this message: green sent, yellow queued, white neither. */
  fwd: FwdCell[];
  /** The node enables Save Attachment only for a B2 message with attachments. */
  attachments: boolean;
}

const COLOUR: Record<string, FwdState> = { '#98FFA0': 'sent', '#FFFF00': 'queued', '#FFFFFF': 'none' };

/** One MsgDetails (or MsgSave, MsgFwdUpdate) reply: the form's fields and the forwarding table. */
export function parseMessageDetail(html: string, n: number): MessageDetail {
  if (!new RegExp(`<h4>Message ${n}</h4>`).test(html)) throw new ParseError(`Message ${n}`, 'record');
  const spec = parseForm(html);
  const v = (name: string): string => {
    const f = spec.fields.find((x) => x.name === name);
    if (!f) throw new ParseError(`Message ${n}`, name);
    return f.value;
  };
  const fwd: FwdCell[] = [];
  for (const m of html.matchAll(/<td style="background-color: (#[0-9A-Fa-f]{6});"onclick=ck\("(\d+)"\)>([^<]*)<\/td>/g)) {
    const state = COLOUR[(m[1] as string).toUpperCase()];
    if (!state) throw new ParseError(`Message ${n}`, `forwarding state for ${m[3]}`);
    fwd.push({ bbs: Number(m[2]), call: m[3] as string, state });
  }
  return {
    id: n, bid: v('BID'), type: v('Type'), status: v('Status'), to: v('To'), from: v('From'),
    via: v('VIA'), size: Number(v('Size')), subject: v('Title'), sent: v('Sent'),
    rx: v('RX'), lastChange: v('LastChange'), efrom: v('EFROM'), fwd,
    attachments: /SaveAttachment\?[^>]*><button type=button class='btn' >/.test(html),
  };
}

/** The fields MsgSave takes, in its order. */
export const MSG_FIELDS = ['from', 'to', 'bid', 'efrom', 'via', 'subject', 'type', 'status'] as const;
export type MsgField = (typeof MSG_FIELDS)[number];
export type MsgEdit = Partial<Record<MsgField, string>>;

/** Bytes each field may carry: the size of its buffer in struct MsgInfo, less the NUL. */
export const MSG_LIMITS: Record<Exclude<MsgField, 'type' | 'status'>, number> = {
  from: 6, to: 6, bid: 12, efrom: 40, via: 40, subject: 60,
};
export const MSG_TYPES = ['B', 'P', 'T'];
export const MSG_STATUSES = ['N', 'Y', 'F', 'K', 'H', 'D', '$'];

export class MsgFieldError extends Error {
  constructor(readonly field: MsgField, message: string) {
    super(message);
    this.name = 'MsgFieldError';
  }
}

const LABEL: Record<MsgField, string> = {
  from: 'From', to: 'To', bid: 'BID', efrom: 'Email from', via: 'VIA', subject: 'Title', type: 'Type', status: 'Status',
};

/**
 * The MsgSave body. A field left as the node sent it goes back as the same bytes; a changed one
 * goes as UTF-8, as the old page's XMLHttpRequest sends it.
 */
export function msgSaveBody(fresh: MessageDetail, edit: MsgEdit): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const k of MSG_FIELDS) {
    const was = fresh[k];
    const now = edit[k] ?? was;
    const bytes = now === was ? latin1Bytes(was) : new TextEncoder().encode(now);
    if (now.includes('|')) throw new MsgFieldError(k, `${LABEL[k]} cannot hold "|": the node splits the record on it`);
    if (/[\r\n]/.test(now)) throw new MsgFieldError(k, `${LABEL[k]} cannot hold a line break`);
    if (k === 'type' && !MSG_TYPES.includes(now)) throw new MsgFieldError(k, `Type must be one of ${MSG_TYPES.join(', ')}`);
    if (k === 'status' && !MSG_STATUSES.includes(now)) throw new MsgFieldError(k, `Status must be one of ${MSG_STATUSES.join(' ')}`);
    if (k !== 'type' && k !== 'status' && bytes.length > MSG_LIMITS[k]) {
      throw new MsgFieldError(k, `${LABEL[k]} is ${bytes.length} bytes; the node keeps at most ${MSG_LIMITS[k]}`);
    }
    parts.push(bytes, latin1Bytes('|'));
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** The status the BBS's own unhold command gives: $ for a bulletin still queued to a partner, else N. */
export function releaseStatus(m: MessageDetail): string {
  return m.type === 'B' && m.fwd.some((c) => c.state === 'queued') ? '$' : 'N';
}

/** MsgDetails for one message, checked to be that message: anything else leaves the node with no current message. */
async function pickMsg(n: number): Promise<MessageDetail> {
  const html = await postMail('MsgDetails', String(n));
  if (!new RegExp(`<h4>Message ${n}</h4>`).test(html)) throw new MessageGoneError(n);
  return parseMessageDetail(html, n);
}

/** The node has no message with this number (killed and removed by housekeeping, say). */
export class MessageGoneError extends Error {
  constructor(readonly n: number) {
    super(`The BBS has no message ${n} now; it may have been removed`);
    this.name = 'MessageGoneError';
  }
}

export function loadMessage(n: number): Promise<MessageDetail> {
  return withSysop(() => exclusive(() => pickMsg(n)));
}

/** The node prints the message file into a page buffer of 250,000 bytes; refuse well short of it. */
export const MAX_TEXT_BYTES = 200_000;

/** The text as stored: UTF-8 when it is valid UTF-8, else one byte per character. */
function storedText(raw: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(latin1Bytes(raw));
  } catch {
    return raw;
  }
}

/** The message file, from the old page's Edit Text page (EditM, a GET), never posted back. */
export function readMessageText(n: number, size: number): Promise<string> {
  if (!Number.isFinite(size) || size > MAX_TEXT_BYTES) {
    return Promise.reject(new Error(`Message ${n} is ${size} bytes; the node's text page holds at most about ${MAX_TEXT_BYTES}, so it is not read here`));
  }
  return withSysop(() => exclusive(async () => {
    await pickMsg(n);
    const html = assertAuthorized(await getText(`/Mail/EditM?${await mailKey()}?${n}`));
    const open = /<textarea[^>]*name=Msg>/.exec(html);
    const close = html.lastIndexOf('</textarea>');
    if (!open || close < open.index) throw new ParseError(`Message ${n} text`, 'text');
    const text = html.slice(open.index + open[0].length, close);
    if (text === 'Message Not Found') throw new Error(`The node has no text file for message ${n}`);
    return storedText(text);
  }));
}


/** The fields a save compares with what the sysop opened, so it never writes back values the node has since changed. */
function sameFields(a: MessageDetail, b: MessageDetail, only?: MsgField[]): boolean {
  return (only ?? MSG_FIELDS).every((k) => a[k] === b[k]);
}

/**
 * MsgSave: pick the message again, check it is as the sysop opened it, post every field with the
 * edits applied. The node answers with the message as saved. `check` 'status' compares only the
 * status (release, hold, kill); 'all' compares every field (the edit form).
 */
export function saveMessage(opened: MessageDetail, edit: MsgEdit, check: 'status' | 'all'): Promise<Outcome<MessageDetail>> {
  const n = opened.id;
  return once(async (post) => {
    const fresh = await pickMsg(n);
    if (!sameFields(opened, fresh, check === 'status' ? ['status'] : undefined)) throw new ChangedOnNodeError();
    const body = msgSaveBody(fresh, edit);
    return parseMessageDetail(await post('MsgSave', body), n);
  }, () => pickMsg(n));
}

export const setStatus = (opened: MessageDetail, status: string): Promise<Outcome<MessageDetail>> => saveMessage(opened, { status }, 'status');

const NEXT: Record<FwdState, FwdState> = { none: 'queued', queued: 'sent', sent: 'none' };
export const nextFwdState = (s: FwdState): FwdState => NEXT[s];

/**
 * Step one partner's forwarding cell, as a click on the old page's table does. The partner must
 * be on the forwarding partner list (the handler uses its ForwardingInfo), the Msgs page is read
 * first so the node's BBS list is current, and the cell must still be as the sysop saw it.
 */
export function stepForward(opened: MessageDetail, bbs: number): Promise<Outcome<MessageDetail>> {
  const n = opened.id;
  const cell = opened.fwd.find((c) => c.bbs === bbs);
  if (!cell) return Promise.reject(new ParseError(`Message ${n}`, `forwarding cell ${bbs}`));
  return once(async (post) => {
    const partners = parseFwdList(await postMail('FwdList.txt', ''));
    if (!partners.some((p) => p.toUpperCase() === cell.call.toUpperCase())) throw new ParseError('Forwarding partners', `partner ${cell.call}`);
    assertAuthorized(await getText(`/Mail/Msgs?${await mailKey()}`));
    const fresh = await pickMsg(n);
    const now = fresh.fwd.find((c) => c.bbs === bbs);
    if (!now || now.call !== cell.call || now.state !== cell.state) throw new ChangedOnNodeError();
    const after = parseMessageDetail(await post('MsgFwdUpdate', latin1Bytes(String(bbs))), n);
    const got = after.fwd.find((c) => c.bbs === bbs);
    if (!got || got.state !== NEXT[cell.state]) {
      throw new ParseError(`Message ${n} reply`, `forwarding state for ${cell.call} (the node shows ${got?.state ?? 'no cell'})`);
    }
    return after;
  }, () => pickMsg(n));
}
