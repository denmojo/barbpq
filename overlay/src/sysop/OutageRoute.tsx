import type { StationPort } from '../data/uiapi';
import type { Poll } from '../data/poll';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Unknown } from '../ui/Unknown';
import { ErrorNote } from '../ui/ErrorNote';
import { Pending, Skel } from '../ui/Skel';
import type { Forwarding, MailStatus } from './model';
import { parseConnectScript, portLabel, scheduleNote } from './model';

/** Where held mail goes: the RMS record's connect script, one hop per try. */
export function OutageRoute({ fwd, status, ports }: { fwd: Poll<Forwarding>; status: Poll<MailStatus>; ports?: StationPort[] }) {
  const rms = fwd.data?.rms;
  const steps = rms ? parseConnectScript(rms.script) : [];
  const note = rms ? scheduleNote(rms) : '';
  const bbs = status.data?.bbs;
  return (
    <Card title="Outage route for held mail" span={7} more={{ href: '#/forwarding', label: 'Edit script →' }}>
      {fwd.error && !fwd.data && <ErrorNote error={fwd.error} />}
      {!fwd.data && !fwd.error && <Skel />}
      {fwd.data && !rms && (
        <EmptyState title="No RMS forwarding record." hint="Add a forwarding partner called RMS on the BBS to route held mail." />
      )}
      {rms && !steps.length && (
        <EmptyState title="The RMS connect script has no connect line." hint="Forwarding has nowhere to go until the script connects somewhere." />
      )}
      {rms && steps.length > 0 && (
        <>
          <ol class="route" aria-label="Forwarding tries in order">
            <li class="hop">
              <div class="t">Held in</div>
              <div class="n">BBS {bbs ?? (status.data ? <Unknown reason="The mail Status page did not name the BBS" /> : <Pending poll={status} />)}</div>
              <div class="s">when CMS is unreachable</div>
            </li>
            {steps.map((s, i) => (
              <>
                <li class="arrow" aria-hidden="true"><b>→</b>{i === 0 ? 'first' : 'else'}</li>
                <li class={i === 0 ? 'hop primary-hop' : 'hop'}>
                  <div class="t">Try</div>
                  <div class="n">{s.label}</div>
                  <div class="s">{portLabel(s.port, ports)}</div>
                </li>
              </>
            ))}
          </ol>
          {note && <div class="route-foot"><span class="note">{note}</span></div>}
          {!rms.enabled && (
            <div class="route-foot"><span class="note warn-text">Forwarding is turned off on the RMS record, so this route is not used.</span></div>
          )}
        </>
      )}
    </Card>
  );
}
