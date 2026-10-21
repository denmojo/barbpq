import { usePoll } from '../data/poll';
import { getLinkStates, getStation } from '../data/uiapi';
import type { StationPort } from '../data/uiapi';
import { Card } from '../ui/Card';
import { ErrorNote } from '../ui/ErrorNote';
import { OfflineBanner } from '../ui/OfflineBanner';
import { StatusPill } from '../ui/StatusPill';
import { Table } from '../ui/Table';
import { Unknown } from '../ui/Unknown';
import { Skel } from '../ui/Skel';
import { formatFreq } from '../ui/format';
import { Footer } from './Footer';
import { linkPillFrom, sortPorts } from './model';
import { useUpdated } from './useUpdated';

function address(p: StationPort, telnetPort: number | null) {
  if (p.driver === 'TELNET') {
    return telnetPort !== null ? `:${telnetPort}` : <Unknown reason="The node did not report a Telnet listen port" />;
  }
  return p.addr ?? <Unknown reason="This driver does not report an address" />;
}

export function Ports() {
  const station = usePoll(getStation, 15_000);
  const links = usePoll(getLinkStates, 20_000);
  const updated = useUpdated(station.data);
  const st = station.data;
  return (
    <>
      <OfflineBanner show={station.stale || links.stale} since={updated} />
      <div class="grid">
        <Card title="Ports" span={12}>
          {station.error && !st && <ErrorNote error={station.error} />}
          {links.error && !links.data && <ErrorNote error={links.error} />}
          {st && (
            <Table
              label="Ports"
              columns={[
                { label: 'Port' }, { label: 'Driver' }, { label: 'Frequency' }, { label: 'Mode' },
                { label: 'Address' }, { label: 'TXTAIL', align: 'right' }, { label: 'Link' },
              ]}
            >
              {sortPorts(st.ports).map((p) => {
                const pill = linkPillFrom(links, p.number);
                return (
                  <tr>
                    <td><span class="cell-port"><span class="ptag sm">{p.number}</span><span class="pname">{p.id || p.driver}</span></span></td>
                    <td class="mono">{p.driver}</td>
                    <td class="mono">{p.freqHz !== null ? formatFreq(p.freqHz) : <Unknown reason="No WL2KREPORT frequency is set for this port" />}</td>
                    <td class="mono">{p.modes.length ? p.modes.join(', ') : <Unknown reason="No WL2KREPORT mode is set for this port" />}</td>
                    <td class="mono">{address(p, st.telnetPort)}</td>
                    <td class="mono r">{p.txtailMs !== null ? `${p.txtailMs} ms` : <Unknown reason="Only KISS ports report TXTAIL" />}</td>
                    <td>{pill ? <StatusPill {...pill} /> : <Skel />}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>
      <Footer version={st?.version} updated={updated} />
    </>
  );
}
