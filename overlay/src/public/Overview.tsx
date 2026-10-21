import { Lock, Mail, MessageSquare } from 'lucide-preact';
import { getUsers } from '../data/api';
import { usePoll } from '../data/poll';
import { getCms, getCounts, getLinkStates, getStation } from '../data/uiapi';
import type { CmsState, Counts, LinkState, Station, StationPort } from '../data/uiapi';
import type { Poll } from '../data/poll';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorNote } from '../ui/ErrorNote';
import { OfflineBanner } from '../ui/OfflineBanner';
import { StatusPill } from '../ui/StatusPill';
import { Unknown } from '../ui/Unknown';
import { Pending, Skel } from '../ui/Skel';
import { formatAgo, formatClock, formatFreq, formatStamp, formatUptime } from '../ui/format';
import { Footer } from './Footer';
import { heroStatus, internetLinks, linkPillFrom, loadHeardFor, portMeta, radioPorts, viaText } from './model';
import { useUpdated } from './useUpdated';

/** Today's time as a clock, an earlier day's with the date. */
function checkedAt(t: string, now: Date = new Date()): string {
  const d = new Date(t);
  return d.toDateString() === now.toDateString() ? formatClock(d) : formatStamp(t);
}

/** The CMS state changes only on a connect attempt, so it is shown with that attempt's time. */
function CmsFact({ poll }: { poll: Poll<CmsState> }) {
  const cms = poll.data;
  if (!cms) return <Pending poll={poll} />;
  if (cms.ok === null) return <Unknown reason="No CMS connect attempt since the node started" />;
  const tried = cms.lastAttempt;
  const title = [
    tried ? `Last CMS connect attempt ${formatStamp(tried)}.` : '',
    cms.ok ? 'It tests the connection, not a login.' : cms.lastSuccess ? `Last reached ${formatStamp(cms.lastSuccess)}.` : '',
  ].filter(Boolean).join(' ') || undefined;
  return (
    <span title={title}>
      <span class={cms.ok ? 'ok-text' : 'down-text'}>{cms.ok ? 'reachable' : 'unreachable'}</span>
      {tried && `, checked ${checkedAt(tried)}`}
    </span>
  );
}

function HeroCard({ station, links, cms }: { station: Poll<Station>; links: Poll<LinkState[]>; cms: Poll<CmsState> }) {
  const st = station.data;
  const hero = heroStatus(st, links.data, { station: station.error, links: links.error });
  return (
    <section class="hero" aria-label="Node status">
      <span class={`pulse ${hero.tone}`} aria-hidden="true" />
      <div class="hero-text">
        <h1 title={hero.reason}>{hero.title}</h1>
        {hero.sub && <p>{hero.sub}</p>}
        {hero.sub2 && <p>{hero.sub2}</p>}
      </div>
      <div class="facts">
        <div class="fact">
          <div class="k">Uptime</div>
          <div class="v">
            {!st ? <Pending poll={station} /> : st.uptimeSec === null
              ? <Unknown reason="The node did not report when it started" />
              : formatUptime(st.uptimeSec)}
          </div>
        </div>
        <div class="fact"><div class="k">CMS</div><div class="v"><CmsFact poll={cms} /></div></div>
        <div class="fact"><div class="k">Version</div><div class="v">{st ? st.version : <Pending poll={station} />}</div></div>
      </div>
    </section>
  );
}

/** One port line: number, name, the mono meta line and its link chip. */
function PortRow({ p, links, telnetPort }: { p: StationPort; links: Poll<LinkState[]>; telnetPort: number | null }) {
  const pill = linkPillFrom(links, p.number);
  return (
    <div class="port">
      <div class="ptag">{p.number}</div>
      <div class="pinfo">
        <div class="pname">{p.id || p.driver}</div>
        <div class="pmeta">{portMeta(p, telnetPort)}</div>
      </div>
      <span />
      {pill ? <StatusPill {...pill} /> : <Skel />}
    </div>
  );
}

/** "Last 24 hours" only when the node says the window is full; "Counts" until it has answered. */
export function countsTitle(c: Counts | undefined): string {
  if (!c) return 'Counts';
  if (c.full) return 'Last 24 hours';
  return c.windowStart ? `Since ${formatClock(c.windowStart)}` : 'Since the counters started';
}

export function Overview() {
  const station = usePoll(getStation, 15_000);
  const links = usePoll(getLinkStates, 20_000);
  const cms = usePoll(getCms, 30_000);
  const counts = usePoll(getCounts, 60_000);
  const users = usePoll(getUsers, 20_000);
  // Heard reads the port list from the station poll above rather than fetching the station again.
  const ports = station.data?.ports;
  const portsKey = ports?.map((p) => p.number).join(',');
  const heard = usePoll(() => loadHeardFor(ports ?? []), 20_000, { enabled: ports !== undefined, key: portsKey });
  const updated = useUpdated(station.data);
  const stale = [station, links, cms, counts, users, heard].some((p) => p.stale);

  const st = station.data;
  const rf = st ? radioPorts(st.ports).filter((p) => p.freqHz !== null) : [];
  const inet = st ? internetLinks(st.ports) : [];
  const freqs = [...new Set(rf.map((p) => formatFreq(p.freqHz as number)))];
  const recent = (heard.data ?? []).slice(0, 5);
  const c = counts.data;
  const stat = (k: string, v: number | undefined) => (
    <div class="stat"><div class="k">{k}</div><div class="v">{v === undefined ? <Pending poll={counts} /> : v}</div></div>
  );

  return (
    <>
      <OfflineBanner show={stale} since={updated} />
      <HeroCard station={station} links={links} cms={cms} />

      <div class="grid">
        <Card title="Radio ports" span={8} more={{ href: '#/ports', label: 'All ports →' }}>
          {station.error && !st && <ErrorNote error={station.error} />}
          {st && radioPorts(st.ports).map((p) => <PortRow p={p} links={links} telnetPort={st.telnetPort} />)}
        </Card>

        <Card title="Recently heard" span={4} more={{ href: '#/heard', label: 'All →' }}>
          {station.error && !st && <ErrorNote error={station.error} />}
          {heard.error && !heard.data && <ErrorNote error={heard.error} />}
          {heard.data && (recent.length ? (
            <ul class="heard">
              {recent.map((h) => (
                <li>
                  <span class="call">{h.call}</span>
                  <span class="via">{[h.port.id || h.port.driver, viaText(h.via)].filter(Boolean).join(' · ')}</span>
                  <span class="ago">
                    {h.lastHeard ? formatAgo(h.lastHeard) : <Unknown reason="The node did not record when it heard this station" />}
                  </span>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon="📻" title="Nothing heard yet." hint="Stations show here as the node's ports hear them." />)}
        </Card>

        {inet.length > 0 && (
          <Card title="Internet links" span={12}>
            {inet.map((p) => <PortRow p={p} links={links} telnetPort={st?.telnetPort ?? null} />)}
          </Card>
        )}

        <Card title="Who's connected" span={6}>
          {users.error && !users.data && <ErrorNote error={users.error} />}
          {users.data && (users.data.length ? (
            <ul class="heard">
              {users.data.map((u) => <li><span class="call">{u.Call}</span></li>)}
            </ul>
          ) : <EmptyState icon="📡" title="Nobody is connected right now." hint="Sessions show here live as stations connect." />)}
        </Card>

        <Card title={countsTitle(c)} span={6}>
          {counts.error && !c && <ErrorNote error={counts.error} />}
          <div class="stat-row">
            {stat('Sessions', c?.sessions)}
            {stat('Messages', c?.messages)}
            {stat('Frames heard', c?.frames)}
            <div class="stat">
              <div class="k">Held mail</div>
              <div class="v"><Unknown reason="Held mail is shown after SysOp sign in" /></div>
            </div>
          </div>
        </Card>

        <Card title="On this node" span={12}>
          <div class="apps">
            {rf.length > 0 && (
              <div class="app-tile">
                <div class="ico"><MessageSquare aria-hidden="true" /></div>
                <div><b>Winlink RMS</b><span>Connect from Winlink Express or Pat on {freqs.join(' or ')}</span></div>
              </div>
            )}
            <div class="app-tile">
              <div class="ico"><Mail aria-hidden="true" /></div>
              <div><b>Webmail</b><span>Read and send BBS mail in the browser</span></div>
              <span class="lock" title="Coming in the next release"><Lock aria-hidden="true" /></span>
            </div>
          </div>
        </Card>
      </div>

      <Footer version={st?.version} updated={updated} />
    </>
  );
}
