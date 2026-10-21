import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { usePoll, type Poll } from '../data/poll';
import { getCms, getEvents, getLinkStates } from '../data/uiapi';
import type { CmsState, LinkState, StationPort, UiEvent } from '../data/uiapi';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ErrorNote } from '../ui/ErrorNote';
import { OfflineBanner } from '../ui/OfflineBanner';
import { Pending, Skel } from '../ui/Skel';
import type { Tone } from '../ui/StatusPill';
import { Unknown } from '../ui/Unknown';
import { formatClock } from '../ui/format';
import { Footer } from '../public/Footer';
import { useUpdated } from '../public/useUpdated';
import { EVENT_WINDOW, linkValue, shortAddr, storeForward, eventTime } from './model';
import type { Forwarding, MailStatus } from './model';
import { OutageRoute } from './OutageRoute';
import { RecentChanges } from './RecentChanges';
import { useShell } from './shell';
import { QUICK_COMMANDS } from './Console';
import { typeCommand } from './consoleproto';
import './console.css';

export const HEALTH_POLL_MS = 30_000;

function HealthCard({ name, tone, value, meta }: {
  name: string; tone: Tone; value: ComponentChildren; meta?: ComponentChildren;
}) {
  return (
    <li class={`hc ${tone}`}>
      <div class="k"><span class="d" aria-hidden="true" />{name}</div>
      <div class="v">{value}</div>
      {meta ? <div class="m">{meta}</div> : null}
    </li>
  );
}

function portCard(name: string, driver: string, ports: StationPort[] | undefined, links: Poll<LinkState[]>, stationPoll: Poll<unknown>) {
  if (!ports) return <HealthCard name={name} tone="idle" value={<Pending poll={stationPoll} />} />;
  const port = ports.find((p) => p.driver === driver);
  if (!port) return <HealthCard name={name} tone="idle" value={<Unknown reason={`No ${driver} port in the node config`} />} />;
  const label = driver === 'VARA' ? 'TNC' : 'KISS';
  const addr = shortAddr(port.addr);
  const meta = [addr ? `${label} ${addr}` : null, port.txtailMs !== null ? `TXTAIL ${port.txtailMs} ms` : null]
    .filter(Boolean).join(' · ');
  if (!links.data) return <HealthCard name={name} tone="idle" value={<Pending poll={links} />} meta={meta} />;
  const v = linkValue(links.data.find((l) => l.number === port.number));
  return (
    <HealthCard name={name} tone={v.tone} meta={meta}
      value={v.value ? <span title={v.reason}>{v.value}</span> : <Unknown reason={v.reason} />} />
  );
}

function cmsCard(cms: Poll<CmsState>) {
  const c = cms.data;
  if (!c) return <HealthCard name="Winlink CMS" tone="idle" value={<Pending poll={cms} />} />;
  if (c.ok === true) {
    return <HealthCard name="Winlink CMS" tone="ok" value="Reachable" meta={c.lastSuccess ? `last login ${eventTime(c.lastSuccess)}` : undefined} />;
  }
  if (c.ok === false) {
    const meta = c.lastSuccess ? `last login ${eventTime(c.lastSuccess)}` : c.lastAttempt ? `tried ${eventTime(c.lastAttempt)}` : undefined;
    return <HealthCard name="Winlink CMS" tone="down" value="Unreachable" meta={meta} />;
  }
  return <HealthCard name="Winlink CMS" tone="idle" value={<Unknown reason="No CMS connect attempt since the node started" />} />;
}

function bbsCard(status: Poll<MailStatus>) {
  const s = status.data;
  if (!s) {
    return status.error
      ? <HealthCard name="BBS" tone="down" value={<Unknown reason={status.error.message} />} meta="Mail Status did not answer" />
      : <HealthCard name="BBS" tone="idle" value={<Skel />} />;
  }
  const users = `${s.users} ${s.users === 1 ? 'user' : 'users'}`;
  return <HealthCard name="BBS" tone="ok" value="Running" meta={s.bbs ? `${s.bbs} · ${users}` : users} />;
}

function storeForwardCard(fwd: Poll<Forwarding>, events: Poll<UiEvent[]>) {
  if (!fwd.data) return <HealthCard name="Store and forward" tone="idle" value={<Pending poll={fwd} />} />;
  const sf = storeForward(fwd.data, events.data);
  const meta = !events.data
    ? events.error ? <Unknown reason={events.error.message} /> : <Skel />
    : sf.metaUnknown ? <Unknown reason={sf.metaUnknown} /> : sf.meta;
  return <HealthCard name="Store and forward" tone={sf.tone} value={sf.reason ? <span title={sf.reason}>{sf.value}</span> : sf.value} meta={meta} />;
}

function MailCard({ status, fwd }: { status: Poll<MailStatus>; fwd: Poll<Forwarding> }) {
  const s = status.data;
  const queued = fwd.data ? (fwd.data.rms ? fwd.data.rms.queued : null) : undefined;
  const tile = (k: string, v: ComponentChildren, title?: string) => (
    <div class="q" title={title}><div class="k">{k}</div><div class="v">{v}</div></div>
  );
  return (
    <Card title="Mail" span={5} more={{ href: '#/messages', label: 'Messages →' }}>
      {status.error && !s && <ErrorNote error={status.error} />}
      <div class="queue">
        {tile('Queued for RMS',
          queued === undefined ? <Pending poll={fwd} /> : queued === null
            ? <Unknown reason={fwd.data?.rms ? 'The RMS forwarding page did not give a queue count' : 'No RMS forwarding record'} />
            : queued,
          'Messages waiting to forward to the RMS partner')}
        {tile('Held', s ? s.held : <Pending poll={status} />, 'Messages the BBS is holding for sysop review')}
        {tile('Messages', s ? s.msgs : <Pending poll={status} />, 'All messages on the BBS')}
      </div>
    </Card>
  );
}

/** Cmd.c RESTART (Cmd.c:4793, handler at 495): on Linux it sets CLOSING and linbpq exits. */
const RESTART = 'RESTART';

function ConsoleCard() {
  return (
    <Card title="Console" span={7} more={{ href: '#/console', label: 'Open full →' }}>
      <div class="term">
        <div class="bar">
          {QUICK_COMMANDS.map((c) => <button key={c} type="button" class="pill" onClick={() => typeCommand(c)}>{c}</button>)}
        </div>
        <div class="dim">Pick a command to run it in the console, or open the console to type one.</div>
        <div><span class="dim">&gt;</span> <span class="cur" aria-hidden="true" /></div>
      </div>
    </Card>
  );
}

export function Health() {
  const [confirm, setConfirm] = useState(false);
  const shell = useShell();
  const links = usePoll(getLinkStates, HEALTH_POLL_MS);
  const cms = usePoll(getCms, HEALTH_POLL_MS);
  // One event poll: Recent changes shows its first ten, store and forward searches all of it.
  const history = usePoll(() => getEvents(EVENT_WINDOW), HEALTH_POLL_MS);
  const recent = useMemo(() => ({ ...history, data: history.data?.slice(0, 10) }), [history]);
  const checked = useUpdated(links.data);
  const ports = shell.station.data?.ports;
  const stale = [links, cms, history, shell.station, shell.status, shell.fwd].some((p) => p.stale);

  return (
    <>
      <div class="titlebar">
        <h1>Health</h1>
        <span class="sub">{checked ? `Checked ${formatClock(checked)}` : 'Checking'} · every {HEALTH_POLL_MS / 1000} s</span>
        <div class="title-actions">
          <button type="button" class="btn" onClick={() => setConfirm(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></svg>
            Restart node
          </button>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog title="Restart node?" command={RESTART} confirmLabel={`Send ${RESTART}`}
          onCancel={() => setConfirm(false)}
          onConfirm={() => { setConfirm(false); typeCommand(RESTART); }}>
          <p>linbpq shuts down and every connected station and session drops. It starts again only if a
            service manager such as systemd restarts it; otherwise it stays down until someone starts it.</p>
        </ConfirmDialog>
      )}
      <OfflineBanner show={stale} since={checked} />

      <ul class="health" aria-label="Health checks">
        {portCard('VARA FM', 'VARA', ports, links, shell.station)}
        {portCard('Dire Wolf', 'KISS', ports, links, shell.station)}
        {cmsCard(cms)}
        {bbsCard(shell.status)}
        {storeForwardCard(shell.fwd, history)}
      </ul>

      <div class="grid">
        <OutageRoute fwd={shell.fwd} status={shell.status} ports={ports} />
        <MailCard status={shell.status} fwd={shell.fwd} />
        <RecentChanges events={recent} span={5} />
        <ConsoleCard />
      </div>
      <Footer version={shell.station.data?.version} updated={checked} />
    </>
  );
}
