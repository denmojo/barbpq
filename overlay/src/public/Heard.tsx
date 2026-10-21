import { useState } from 'preact/hooks';
import { usePoll } from '../data/poll';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorNote } from '../ui/ErrorNote';
import { OfflineBanner } from '../ui/OfflineBanner';
import { Table } from '../ui/Table';
import { Tabs } from '../ui/Tabs';
import { Unknown } from '../ui/Unknown';
import { formatAgo, formatStamp } from '../ui/format';
import { Footer } from './Footer';
import { loadHeard, viaText } from './model';
import { useUpdated } from './useUpdated';

export function Heard() {
  const heard = usePoll(loadHeard, 20_000);
  const updated = useUpdated(heard.data);
  const [tab, setTab] = useState('all');
  const d = heard.data;
  const rows = d ? d.rows.filter((r) => tab === 'all' || String(r.port.number) === tab) : [];
  return (
    <>
      <OfflineBanner show={heard.stale} since={updated} />
      <div class="grid">
        <Card title="Heard" span={12}>
          {heard.error && !d && <ErrorNote error={heard.error} />}
          {d && (
            <>
              <Tabs
                label="Port"
                value={tab}
                onChange={setTab}
                items={[{ id: 'all', label: 'All ports' }, ...d.ports.map((p) => ({ id: String(p.number), label: p.id || p.driver }))]}
              />
              {rows.length ? (
                <Table
                  label="Stations heard"
                  columns={[{ label: 'Call' }, { label: 'Port' }, { label: 'Path' }, { label: 'Packets', align: 'right' }, { label: 'Last heard' }]}
                >
                  {rows.map((h) => (
                    <tr>
                      <td><span class="call">{h.call}</span></td>
                      <td>{h.port.id || h.port.driver}</td>
                      <td class="muted">{viaText(h.via)}</td>
                      <td class="mono r">{h.packets}</td>
                      <td class="mono">
                        {h.lastHeard
                          ? <>{formatStamp(h.lastHeard)} <span class="faint">· {formatAgo(h.lastHeard)}</span></>
                          : <Unknown reason="The node did not record when it heard this station" />}
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <EmptyState
                  icon="📻"
                  title={tab === 'all' ? 'Nothing heard yet.' : 'Nothing heard on this port yet.'}
                  hint="Stations show here as the node's ports hear them."
                />
              )}
            </>
          )}
        </Card>
      </div>
      <Footer updated={updated} />
    </>
  );
}
