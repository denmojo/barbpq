// The sysop sidebar: Health, then Network, Mail and System. Shared with the command palette.
import type { FunctionComponent } from 'preact';
import type { Route } from '../app/router';
import {
  IconConsole, IconForwarding, IconHealth, IconHeard, IconHousekeeping, IconLinks, IconLogs,
  IconMessages, IconPorts, IconSessions, IconSettings, IconUsers,
} from './icons';

export interface NavItem { route: Route; label: string; icon: FunctionComponent; keywords?: string }
export interface NavGroup { heading: string | null; items: NavItem[] }

export const NAV: NavGroup[] = [
  { heading: null, items: [{ route: 'health', label: 'Health', icon: IconHealth, keywords: 'home status cms vara dire wolf' }] },
  {
    heading: 'Network',
    items: [
      { route: 'ports', label: 'Ports', icon: IconPorts, keywords: 'radio vara kiss telnet' },
      { route: 'heard', label: 'Heard', icon: IconHeard, keywords: 'mheard stations callsign' },
      { route: 'links', label: 'Links & routes', icon: IconLinks, keywords: 'neighbours nodes netrom' },
      { route: 'sessions', label: 'Sessions', icon: IconSessions, keywords: 'connected users' },
    ],
  },
  {
    heading: 'Mail',
    items: [
      { route: 'messages', label: 'Messages', icon: IconMessages, keywords: 'bbs mail held' },
      { route: 'forwarding', label: 'Forwarding', icon: IconForwarding, keywords: 'rms connect script store forward' },
      { route: 'bbsusers', label: 'BBS users', icon: IconUsers, keywords: 'accounts' },
      { route: 'housekeeping', label: 'Housekeeping', icon: IconHousekeeping, keywords: 'expire purge' },
    ],
  },
  {
    heading: 'System',
    items: [
      { route: 'settings', label: 'Settings', icon: IconSettings, keywords: 'config bpq32.cfg' },
      { route: 'console', label: 'Console', icon: IconConsole, keywords: 'terminal command' },
      { route: 'logs', label: 'Logs', icon: IconLogs, keywords: 'debug log' },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

/** Screens later tasks build; until then their sidebar entries open a "Coming in this release" screen. */
export const COMING: Route[] = ['messages', 'forwarding', 'bbsusers', 'housekeeping', 'settings', 'console', 'logs'];

export const SYSOP_ROUTES: Route[] = ['health', ...COMING];

export const labelOf = (r: Route): string => NAV_ITEMS.find((i) => i.route === r)?.label ?? (r === 'overview' ? 'Overview' : r);
