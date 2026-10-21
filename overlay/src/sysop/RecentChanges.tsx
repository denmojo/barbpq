import type { ComponentChildren } from 'preact';
import type { Poll } from '../data/poll';
import type { UiEvent } from '../data/uiapi';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorNote } from '../ui/ErrorNote';
import { Skel } from '../ui/Skel';
import { formatStamp } from '../ui/format';
import { Unknown } from '../ui/Unknown';
import { eventTime } from './model';

const FWD_UNKNOWN = 'This run logged no CMS result within the node\'s wait, so whether it fell back is not known';

/** Dot tone and words for one event. The dot repeats the words; it never carries meaning alone. */
export function describeEvent(e: UiEvent): { tone: 'ok' | 'warn' | 'info' | 'idle'; text: ComponentChildren } {
  switch (e.kind) {
    case 'restart':
      return { tone: 'warn', text: 'Node restarted' };
    case 'cfgsave':
      return { tone: 'info', text: <>Node config <code>bpq32.cfg</code> saved</> };
    case 'mailsave':
      return { tone: 'info', text: 'Mail settings saved' };
    case 'forward': {
      const route = typeof e.detail.route === 'string' && e.detail.route ? e.detail.route : null;
      const cms = e.detail.cmsReachable;
      const where = route ? <> via <code>{route}</code></> : null;
      if (cms === false) return { tone: 'warn', text: <>Forwarded{where} while CMS was unreachable</> };
      if (cms === true) return { tone: 'ok', text: <>Forwarded{where}</> };
      // null (or left out): the node logged no CMS result for this run, as Health's Store and forward card words it
      return {
        tone: 'idle',
        text: <>Forwarded{where}, CMS result <Unknown reason={FWD_UNKNOWN} /></>,
      };
    }
    default:
      return { tone: 'info', text: String((e as { kind: string }).kind) };
  }
}

/** The node's event log, newest first as the node lists it. */
export function RecentChanges({ events }: { events: Poll<UiEvent[]> }) {
  const list = events.data;
  return (
    <Card title="Recent changes" span={5}>
      {events.error && !list && <ErrorNote error={events.error} />}
      {!list && !events.error && <Skel />}
      {list && (list.length ? (
        <ul class="feed">
          {list.map((e) => {
            const d = describeEvent(e);
            return (
              <li>
                <time dateTime={e.t} title={formatStamp(e.t)}>{eventTime(e.t)}</time>
                <span class={`ic ${d.tone}`} aria-hidden="true" />
                <span>{d.text}</span>
              </li>
            );
          })}
        </ul>
      ) : <EmptyState title="No changes recorded yet." hint="Restarts, config saves and forwarding runs show here." />)}
    </Card>
  );
}
