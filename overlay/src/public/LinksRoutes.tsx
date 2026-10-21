import { getLinks, getNodes } from '../data/api';
import { fetchRoutes } from '../data/pages';
import { usePoll } from '../data/poll';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorNote } from '../ui/ErrorNote';
import { OfflineBanner } from '../ui/OfflineBanner';
import { StatusPill } from '../ui/StatusPill';
import { Table } from '../ui/Table';
import { Footer } from './Footer';
import { useUpdated } from './useUpdated';

export function LinksRoutes() {
  const links = usePoll(getLinks, 15_000);
  const routes = usePoll(fetchRoutes, 30_000);
  const nodes = usePoll(getNodes, 60_000);
  const updated = useUpdated(links.data);
  return (
    <>
      <OfflineBanner show={links.stale || routes.stale || nodes.stale} since={updated} />
      <div class="grid">
        <Card title="Links" span={12}>
          {links.error && !links.data && <ErrorNote error={links.error} />}
          {links.data && (links.data.length ? (
            <Table label="Links" columns={[{ label: 'Far call' }, { label: 'Our call' }, { label: 'Port' }, { label: 'State' }, { label: 'Type' }, { label: 'AX.25' }]}>
              {links.data.map((l) => (
                <tr>
                  <td><span class="call">{l.farCall}</span></td>
                  <td class="mono">{l.ourCall}</td>
                  <td class="mono">{l.port}</td>
                  <td>{l.state}</td>
                  <td>{l.linkType}</td>
                  <td class="mono">{l.ax25Version}</td>
                </tr>
              ))}
            </Table>
          ) : <EmptyState icon="🔗" title="No links are up right now." hint="AX.25 links to other nodes show here while they are connected." />)}
        </Card>

        <Card title="Neighbours" span={12}>
          {routes.error && !routes.data && <ErrorNote error={routes.error} />}
          {routes.data && (routes.data.length ? (
            <Table
              label="Neighbours"
              columns={[
                { label: 'Call' }, { label: 'Port' }, { label: 'Link' }, { label: 'Quality', align: 'right' },
                { label: 'Nodes', align: 'right' }, { label: 'Frames', align: 'right' }, { label: 'Retries', align: 'right' }, { label: 'Last heard' },
              ]}
            >
              {routes.data.map((r) => (
                <tr>
                  <td><span class="call">{r.call}</span>{r.locked && <span class="faint" title="Locked quality"> {r.locked}</span>}</td>
                  <td class="mono">{r.port}</td>
                  <td>{r.active ? <StatusPill tone="ok" label="Up" title="An L2 link to this neighbour is up" /> : <StatusPill tone="idle" label="Idle" title="No L2 link to this neighbour now" />}</td>
                  <td class="mono r">{r.quality}</td>
                  <td class="mono r">{r.nodeCount}</td>
                  <td class="mono r">{r.frames}</td>
                  <td class="mono r">{r.retries} <span class="faint">({r.percent}%)</span></td>
                  <td class="mono">{r.lastHeard}</td>
                </tr>
              ))}
            </Table>
          ) : <EmptyState icon="🧭" title="No neighbours yet." hint="Nodes this one routes through show here once heard or configured." />)}
        </Card>

        <Card title="Nodes" span={12}>
          {nodes.error && !nodes.data && <ErrorNote error={nodes.error} />}
          {nodes.data && (nodes.data.length ? (
            <Table label="Nodes" columns={[{ label: 'Call' }, { label: 'Alias' }, { label: 'Best route' }, { label: 'Quality', align: 'right' }]}>
              {nodes.data.map((n) => {
                const best = [...n.Routes].sort((a, b) => b.Quality - a.Quality)[0];
                return (
                  <tr>
                    <td><span class="call">{n.Call}</span></td>
                    <td class="mono">{n.Alias}</td>
                    <td class="mono">{best ? `${best.Call} on port ${best.Port}` : ''}</td>
                    <td class="mono r">{best ? best.Quality : ''}</td>
                  </tr>
                );
              })}
            </Table>
          ) : <EmptyState icon="🗺️" title="No nodes known yet." hint="NET/ROM nodes show here as neighbours broadcast them." />)}
        </Card>
      </div>
      <Footer updated={updated} />
    </>
  );
}
