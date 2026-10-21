// Populated sample data for the public screens. Staging hears nothing, so these
// cover the populated rendering the live node cannot show.
import type { Info, Link, NodeEntry, Session } from '../../data/api';
import type { CmsState, Counts, Heard, LinkState, Station } from '../../data/uiapi';
import type { Route } from '../../data/pages';

export const info: Info = { NodeCall: 'AD6DM-11', Alias: 'EGNOD', Locator: 'CM98hj', Version: '6.0.26.1' };

export const station: Station = {
  call: 'AD6DM-11', alias: 'EGNOD', locator: 'CM98hj', version: '6.0.26.1',
  uptimeSec: 2 * 86400 + 4 * 3600 + 17 * 60, telnetPort: 8010,
  ports: [
    { number: 1, id: 'Telnet Server', driver: 'TELNET', freqHz: null, modes: [], addr: null, txtailMs: null },
    { number: 3, id: 'VARA FM', driver: 'VARA', freqHz: 145630000, modes: ['VARAFM96'], addr: '127.0.0.1:8300', txtailMs: null },
    { number: 2, id: 'Direwolf', driver: 'KISS', freqHz: 145630000, modes: ['PKT1200'], addr: '127.0.0.1:8001', txtailMs: 100 },
  ],
};

export const linkStates: LinkState[] = [
  { number: 1, state: 'unknown', detail: 'driver reports no link state' },
  { number: 3, state: 'linked', detail: 'connected to VARA modem' },
  { number: 2, state: 'down', detail: 'KISS TCP not connected' },
];

export const cms: CmsState = { lastAttempt: '2026-10-20T15:00:00Z', lastSuccess: '2026-10-20T15:00:00Z', ok: true };

export const countsFull: Counts = { windowStart: '2026-10-19T16:12:00Z', full: true, sessions: 3, messages: 7, frames: 412 };
export const countsPartial: Counts = { windowStart: '2026-10-20T16:12:00Z', full: false, sessions: 1, messages: 0, frames: 12 };

// "now" for clock tests: 2026-10-20 10:00 America/Los_Angeles (PDT)
export const NOW = new Date('2026-10-20T17:00:00Z');

export const heardByPort: Record<number, Heard[]> = {
  1: [],
  2: [
    { call: 'W6SAR-10', packets: 40, lastHeard: '2026-10-20T16:56:00Z', via: [] },
    { call: 'N6UG', packets: 3, lastHeard: '2026-10-20T16:43:00Z', via: ['W6SAR-10'] },
  ],
  3: [{ call: 'AD6DM', packets: 9, lastHeard: '2026-10-20T14:00:00Z', via: [] }],
};

export const users: Session[] = [];
export const links: Link[] = [
  { farCall: 'W6SAR-10', ourCall: 'AD6DM-11', port: '2', state: 'Connected', linkType: 'Uplink', ax25Version: '2' },
];
export const nodes: NodeEntry[] = [
  { Call: 'W6SAR-10', Alias: 'SARNOD', Routes: [{ Call: 'W6SAR-10', Port: 2, Quality: 192 }] },
];
export const routes: Route[] = [{
  port: 2, active: true, call: 'W6SAR-10', locked: '', quality: 192, nodeCount: 4, frames: 120, retries: 2,
  percent: 1, maxframe: 4, frack: 7000, lastHeard: '20 16:56', queued: 0, remQuality: 0, srtt: null, remSrtt: null,
}];
