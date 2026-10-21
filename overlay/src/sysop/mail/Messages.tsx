// Messages: every BBS message, read the way the old Msgs page reads them (MsgInfo.txt, then
// one MsgDetails each), with counts taken from their status fields. A message opens in a panel
// (MessagePanel) for its details, its text and the changes the old page allows.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorNote } from '../../ui/ErrorNote';
import { Skel } from '../../ui/Skel';
import { Table } from '../../ui/Table';
import { Unknown } from '../../ui/Unknown';
import { formatClock } from '../../ui/format';
import { Footer } from '../../public/Footer';
import { IconMessages } from '../icons';
import { fetchMessages, type MailMessage } from './maildata';
import { MessagePanel, STATUS_NAME } from './MessagePanel';
import { messageNote, openMessage } from './drafts';

const changedNote = (n: number): string | null => (n ? `${n} ${n === 1 ? 'message' : 'messages'} changed while reading` : null);
import './mail.css';

/** Status letters as the node stores them (MsgInfo.status; the Status select on MsgDetails). */
export const STATUS = STATUS_NAME;
const TYPE: Record<string, string> = { P: 'Personal', B: 'Bulletin', T: 'NTS' };

const NO_BOUNCED = 'LinBPQ has no bounced status: a returned message arrives as a new message, so the list cannot count bounces';

/** The list's columns, from a message's details. */
const pickRow = (d: MailMessage): MailMessage => ({
  id: d.id, bid: d.bid, type: d.type, status: d.status, to: d.to, from: d.from, via: d.via, size: d.size, subject: d.subject, sent: d.sent,
});

/** Held is status H, sent is status F (forwarded). */
export function messageCounts(msgs: MailMessage[]): { held: number; sent: number } {
  const n = (s: string) => msgs.filter((m) => m.status === s).length;
  return { held: n('H'), sent: n('F') };
}

type Load =
  | { phase: 'loading'; done: number; total: number | null; changed: number }
  | { phase: 'done'; msgs: MailMessage[]; changed: number; at: Date }
  | { phase: 'error'; error: Error };

function Tile({ k, title, children }: { k: string; title: string; children: ComponentChildren }) {
  return <div class="q" title={title}><div class="k">{k}</div><div class="v">{children}</div></div>;
}

function Row({ m, open, onOpen }: { m: MailMessage; open: boolean; onOpen: () => void }) {
  return (
    <tr class={[m.status === 'H' ? 'held' : '', open ? 'open' : ''].join(' ').trim() || undefined}>
      <td class="mono r">
        <button type="button" class="msg-open" aria-label={`Open message ${m.id}`} aria-pressed={open ? 'true' : 'false'} onClick={onOpen}>{m.id}</button>
      </td>
      <td title={TYPE[m.type] ?? m.type}>{m.type}</td>
      <td>{STATUS[m.status] ?? <Unknown reason={`Status letter "${m.status}" is not one LinBPQ documents`} />}</td>
      <td class="mono">{m.from}</td>
      <td class="mono">{m.to}{m.via ? `@${m.via}` : ''}</td>
      <td class="subj">{m.subject}</td>
      <td class="mono r">{Number.isFinite(m.size) ? m.size : <Unknown reason="The node gave no size" />}</td>
      <td class="mono">{m.sent || <Unknown reason="The node gave no date" />}</td>
    </tr>
  );
}

export function Messages() {
  const [load, setLoad] = useState<Load>({ phase: 'loading', done: 0, total: null, changed: 0 });
  const [tries, setTries] = useState(0);
  const openId = openMessage.value;
  const setOpenId = (id: number | null): void => { openMessage.value = id; if (id === null) messageNote.value = null; };
  // A change made from the panel shows in its row from the node's reply, without reading every message again.
  const changed = (d: MailMessage): void => {
    setLoad((l) => (l.phase === 'done' ? { ...l, msgs: l.msgs.map((x) => (x.id === d.id ? { ...x, ...pickRow(d) } : x)) } : l));
  };
  // One request per message on the node: read when the screen opens and on Refresh, never on a timer.
  useEffect(() => {
    let alive = true;
    setLoad({ phase: 'loading', done: 0, total: null, changed: 0 });
    fetchMessages((done, total, changed) => { if (alive) setLoad({ phase: 'loading', done, total, changed }); }).then(
      (r) => { if (alive) setLoad({ phase: 'done', msgs: r.msgs, changed: r.changed, at: new Date() }); },
      (e: unknown) => { if (alive) setLoad({ phase: 'error', error: e instanceof Error ? e : new Error(String(e)) }); },
    );
    return () => { alive = false; };
  }, [tries]);

  const counts = load.phase === 'done' ? messageCounts(load.msgs) : null;
  const count = (v: number | undefined) =>
    load.phase === 'error' ? <Unknown reason={`The message list did not load: ${load.error.message}`} /> : v === undefined ? <Skel /> : v;
  // A message removed while the list is read is left out and counted here, not treated as a failure.
  const progress = load.phase === 'loading'
    ? [load.total === null ? 'Reading the message list' : `Reading message ${load.done + 1} of ${load.total}`, changedNote(load.changed)].filter(Boolean).join(' · ')
    : load.phase === 'done' ? changedNote(load.changed) : null;

  return (
    <>
      <div class="titlebar">
        <h1>Messages</h1>
        <span class="sub">
          {load.phase === 'done' ? `${load.msgs.length} on the BBS · read ${formatClock(load.at)}` : load.phase === 'error' ? 'Not loaded' : 'Loading'}
        </span>
        <div class="mf-actions">
          <button type="button" class="btn" disabled={load.phase === 'loading'} onClick={() => setTries((n) => n + 1)}>Refresh</button>
        </div>
      </div>
      <div class="grid">
        {openId !== null && <MessagePanel id={openId} onClose={() => setOpenId(null)} onChanged={changed} />}
        <Card title="Message counts" span={12}>
          <div class="queue">
            <Tile k="Held" title="Messages with status H, held for sysop review">{count(counts?.held)}</Tile>
            <Tile k="Sent" title="Messages with status F, forwarded">{count(counts?.sent)}</Tile>
            <Tile k="Bounced" title="Messages returned undelivered">{load.phase === 'loading' ? <Skel /> : <Unknown reason={NO_BOUNCED} />}</Tile>
          </div>
        </Card>
        <Card title="Message list" span={12}>
          {progress && <p class="mf-note" role="status">{progress}</p>}
          {load.phase === 'error' && <ErrorNote error={load.error} />}
          {load.phase === 'done' && (load.msgs.length === 0 ? (
            <EmptyState icon={<IconMessages />} title="No messages on the BBS." />
          ) : (
            <Table label="Messages" columns={[
              { label: '#', align: 'right' }, { label: 'Type' }, { label: 'Status' }, { label: 'From' }, { label: 'To' },
              { label: 'Subject' }, { label: 'Size', align: 'right' }, { label: 'Sent' },
            ]}>
              {load.msgs.map((m) => <Row key={m.id} m={m} open={m.id === openId} onOpen={() => setOpenId(m.id === openId ? null : m.id)} />)}
            </Table>
          ))}
        </Card>
      </div>
      <Footer updated={load.phase === 'done' ? load.at : undefined} />
    </>
  );
}
