// Messages: the BBS message list from the Mail API, with counts taken from its status fields.
import type { ComponentChildren } from 'preact';
import { usePoll } from '../../data/poll';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorNote } from '../../ui/ErrorNote';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { Pending } from '../../ui/Skel';
import { Table } from '../../ui/Table';
import { Unknown } from '../../ui/Unknown';
import { formatClock, formatStamp } from '../../ui/format';
import { Footer } from '../../public/Footer';
import { useUpdated } from '../../public/useUpdated';
import { IconMessages } from '../icons';
import { fetchMessages, type MailMessage, type MessageList } from './maildata';
import './mail.css';

export const MESSAGES_POLL_MS = 60_000;

/** Status letters as the node stores them (MsgInfo.status). */
export const STATUS: Record<string, string> = {
  N: 'New', Y: 'Read', F: 'Forwarded', K: 'Killed', H: 'Held', D: 'Delivered', $: 'Bulletin',
};
const TYPE: Record<string, string> = { P: 'Personal', B: 'Bulletin', T: 'NTS' };

const NOT_SYSOP = 'The mail API answered this session not as sysop, so its list leaves out messages a sysop would see';
const NO_BOUNCED = 'LinBPQ has no bounced status: a returned message arrives as a new message, so the list cannot count bounces';

export interface MessageCounts { held: number | null; sent: number | null; reason: string | null }

/** Held is status H, sent is status F (forwarded). Neither is known from a list scoped below sysop. */
export function messageCounts(list: MessageList): MessageCounts {
  if (!list.sysopScope) return { held: null, sent: null, reason: NOT_SYSOP };
  const n = (s: string) => list.msgs.filter((m) => m.status === s).length;
  return { held: n('H'), sent: n('F'), reason: null };
}

function Tile({ k, title, children }: { k: string; title: string; children: ComponentChildren }) {
  return <div class="q" title={title}><div class="k">{k}</div><div class="v">{children}</div></div>;
}

function Row({ m }: { m: MailMessage }) {
  const created = Number.isFinite(m.created) && m.created > 0 ? new Date(m.created * 1000).toISOString() : null;
  return (
    <tr class={m.status === 'H' ? 'held' : undefined}>
      <td class="mono r">{m.id}</td>
      <td title={TYPE[m.type] ?? m.type}>{m.type}</td>
      <td>{STATUS[m.status] ?? <Unknown reason={`Status letter "${m.status}" is not one LinBPQ documents`} />}</td>
      <td class="mono">{m.from}</td>
      <td class="mono">{m.to}</td>
      <td class="subj">{m.subject}</td>
      <td class="mono r">{m.size}</td>
      <td>{created ? formatStamp(created) : <Unknown reason="The API gave no creation time" />}</td>
    </tr>
  );
}

export function Messages() {
  const poll = usePoll(fetchMessages, MESSAGES_POLL_MS);
  const updated = useUpdated(poll.data);
  const list = poll.data;
  const counts = list ? messageCounts(list) : null;
  const count = (v: number | null | undefined) =>
    counts === null ? <Pending poll={poll} /> : v === null || v === undefined ? <Unknown reason={counts.reason ?? ''} /> : v;

  return (
    <>
      <div class="titlebar">
        <h1>Messages</h1>
        <span class="sub">{list ? `${list.msgs.length} in the list` : 'Loading'}{updated ? ` · checked ${formatClock(updated)}` : ''}</span>
      </div>
      <OfflineBanner show={poll.stale} since={updated} />
      <div class="grid">
        <Card title="Message counts" span={12}>
          <div class="queue">
            <Tile k="Held" title="Messages with status H, held for sysop review">{count(counts?.held)}</Tile>
            <Tile k="Sent" title="Messages with status F, forwarded">{count(counts?.sent)}</Tile>
            <Tile k="Bounced" title="Messages returned undelivered">{counts === null ? <Pending poll={poll} /> : <Unknown reason={NO_BOUNCED} />}</Tile>
          </div>
        </Card>
        <Card title="Message list" span={12}>
          {list && !list.sysopScope && (
            <p class="mf-note" role="status">
              The mail API treats this session as a regular user, so this list holds only the messages a non-sysop may read (bulletins and mail to that user).
            </p>
          )}
          {poll.error && <ErrorNote error={poll.error} />}
          {!list ? <Pending poll={poll} /> : list.msgs.length === 0 ? (
            <EmptyState icon={<IconMessages />} title="No messages in the list." />
          ) : (
            <Table label="Messages" columns={[
              { label: '#', align: 'right' }, { label: 'Type' }, { label: 'Status' }, { label: 'From' }, { label: 'To' },
              { label: 'Subject' }, { label: 'Size', align: 'right' }, { label: 'Created' },
            ]}>
              {list.msgs.map((m) => <Row key={m.id} m={m} />)}
            </Table>
          )}
        </Card>
      </div>
      <Footer updated={updated} />
    </>
  );
}
