// Messages: every BBS message, read the way the old Msgs page reads them (MsgInfo.txt, then
// one MsgDetails each), with counts taken from their status fields.
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
import './mail.css';

/** Status letters as the node stores them (MsgInfo.status; the Status select on MsgDetails). */
export const STATUS: Record<string, string> = {
  N: 'New', Y: 'Read', F: 'Forwarded', K: 'Killed', H: 'Held', D: 'Delivered', $: 'Bulletin',
};
const TYPE: Record<string, string> = { P: 'Personal', B: 'Bulletin', T: 'NTS' };

const NO_BOUNCED = 'LinBPQ has no bounced status: a returned message arrives as a new message, so the list cannot count bounces';

/** Held is status H, sent is status F (forwarded). */
export function messageCounts(msgs: MailMessage[]): { held: number; sent: number } {
  const n = (s: string) => msgs.filter((m) => m.status === s).length;
  return { held: n('H'), sent: n('F') };
}

type Load =
  | { phase: 'loading'; done: number; total: number | null }
  | { phase: 'done'; msgs: MailMessage[]; at: Date }
  | { phase: 'error'; error: Error };

function Tile({ k, title, children }: { k: string; title: string; children: ComponentChildren }) {
  return <div class="q" title={title}><div class="k">{k}</div><div class="v">{children}</div></div>;
}

function Row({ m }: { m: MailMessage }) {
  return (
    <tr class={m.status === 'H' ? 'held' : undefined}>
      <td class="mono r">{m.id}</td>
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
  const [load, setLoad] = useState<Load>({ phase: 'loading', done: 0, total: null });
  const [tries, setTries] = useState(0);
  // One request per message on the node: read when the screen opens and on Refresh, never on a timer.
  useEffect(() => {
    let alive = true;
    setLoad({ phase: 'loading', done: 0, total: null });
    fetchMessages((done, total) => { if (alive) setLoad({ phase: 'loading', done, total }); }).then(
      (msgs) => { if (alive) setLoad({ phase: 'done', msgs, at: new Date() }); },
      (e: unknown) => { if (alive) setLoad({ phase: 'error', error: e instanceof Error ? e : new Error(String(e)) }); },
    );
    return () => { alive = false; };
  }, [tries]);

  const counts = load.phase === 'done' ? messageCounts(load.msgs) : null;
  const count = (v: number | undefined) =>
    load.phase === 'error' ? <Unknown reason={`The message list did not load: ${load.error.message}`} /> : v === undefined ? <Skel /> : v;
  const progress = load.phase === 'loading'
    ? load.total === null ? 'Reading the message list' : `Reading message ${load.done + 1} of ${load.total}`
    : null;

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
              {load.msgs.map((m) => <Row key={m.id} m={m} />)}
            </Table>
          ))}
        </Card>
      </div>
      <Footer updated={load.phase === 'done' ? load.at : undefined} />
    </>
  );
}
