import { Fragment, type JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { navigate, route, type Route } from '../app/router';
import { signOut } from '../data/session';
import { effectiveTheme, systemDark, themeMode, toggleTheme } from '../ui/theme';
import { Unknown } from '../ui/Unknown';
import { PUBLIC_SCREENS, useDocTitle } from '../public/screens';
import { getInfo } from '../data/api';
import { useOnce } from '../data/poll';
import '../public/public.css';
import './sysop.css';
import { CommandPalette, usePaletteHotkey } from './CommandPalette';
import { ComingSoon } from './ComingSoon';
import { Health } from './Health';
import { IconMenu, IconMoon, IconSearch, IconSignOut } from './icons';
import { COMING, labelOf, NAV, type NavItem } from './nav';
import { registerPaletteItems } from './palette';
import { ShellContext, useShellPolls, type ShellData } from './shell';
import { NodeSettings, useSettingsPalette } from './settings/NodeSettings';
import { resetSettings } from './settings/draft';
import { BbsUsers } from './mail/BbsUsers';
import { resetMail } from './mail/drafts';
import { Forwarding } from './mail/Forwarding';
import { Housekeeping } from './mail/Housekeeping';
import { MailSettings } from './mail/MailSettings';
import { Messages } from './mail/Messages';
import { useMailPalette } from './mail/palette';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const PALETTE_KEY = IS_MAC ? '⌘K' : 'Ctrl K';

const MAIL_SCREENS: Partial<Record<Route, () => JSX.Element>> = {
  messages: () => <Messages />,
  forwarding: () => <Forwarding />,
  bbsusers: () => <BbsUsers />,
  housekeeping: () => <Housekeeping />,
  mailsettings: () => <MailSettings />,
};

function doSignOut(): void {
  // An explicit sign-out forgets the loaded config and any draft (an expired session keeps them).
  resetSettings();
  resetMail();
  signOut();
  navigate('overview');
}

/** The shell's own palette entries: every sidebar screen, the public overview, theme and sign out. */
function usePaletteBase(): void {
  useEffect(() => registerPaletteItems([
    ...NAV.flatMap((g) => g.items.map((i) => ({ label: i.label, route: i.route, group: 'Go to', keywords: `${g.heading ?? ''} ${i.keywords ?? ''}` }))),
    { label: 'Overview (public page)', route: 'overview', group: 'Go to', keywords: 'home visitor' },
    { label: 'Switch theme', action: toggleTheme, group: 'Command', keywords: 'dark light mode' },
    { label: 'Sign out', action: doSignOut, group: 'Command', keywords: 'log out logout' },
  ]), []);
}

function count(item: NavItem, d: ShellData): { n: number; title: string } | null {
  switch (item.route) {
    case 'ports': return d.station.data ? { n: d.station.data.ports.length, title: 'Ports in the node config' } : null;
    case 'sessions': return d.users.data ? { n: d.users.data.length, title: 'Stations connected now' } : null;
    case 'messages': return d.status.data ? { n: d.status.data.msgs, title: 'Messages on the BBS' } : null;
    case 'forwarding': return d.fwd.data ? { n: d.fwd.data.partners.length, title: 'Forwarding partners' } : null;
    default: return null;
  }
}

function Sidebar({ current, data, open, onPick }: { current: Route; data: ShellData; open: boolean; onPick: () => void }) {
  return (
    <aside id="sys-nav" class={open ? 'side open' : 'side'} aria-label="SysOp navigation">
      {NAV.map((g) => (
        <Fragment key={g.heading ?? 'top'}>
          {g.heading && <div class="navh">{g.heading}</div>}
          {g.items.map((i) => {
            const c = count(i, data);
            return (
              <a key={i.route} href={`#/${i.route}`} aria-current={i.route === current ? 'page' : undefined} onClick={onPick}>
                <i.icon />
                {i.label}
                {c && <span class="count" title={c.title}>{c.n}</span>}
              </a>
            );
          })}
        </Fragment>
      ))}
    </aside>
  );
}

export function SysopLayout() {
  const data = useShellPolls();
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  usePaletteHotkey(openPalette);
  usePaletteBase();
  useSettingsPalette();
  useMailPalette();

  const st = data.station.data;
  const call = st?.call;
  // The node call does not change while the node runs: read it once.
  const info = useOnce(getInfo);
  useDocTitle(info);
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  void systemDark.value; // re-render when the OS theme changes
  const theme = effectiveTheme();
  const r = route.value;
  const PublicScreen = PUBLIC_SCREENS[r];
  // The sysop is the node's owner: show the station call without its SSID.
  const me = call ? call.replace(/-\d+$/, '') : null;

  return (
    <ShellContext.Provider value={data}>
      <div class="sys">
        <header class="hdr sys-hdr">
          <button type="button" class="iconbtn menu-btn" aria-label="Menu" aria-expanded={menu ? 'true' : 'false'} aria-controls="sys-nav"
            onClick={() => setMenu(!menu)}>
            <IconMenu />
          </button>
          <a class="brand" href="#/health" aria-label="Health (home)">
            <div class="logo" aria-hidden="true">{st ? st.alias.slice(0, 2) : ''}</div>
            <div class="brand-text">
              <div class="brand-name">
                {st ? st.call : data.station.error ? <Unknown reason={`The node did not answer: ${data.station.error.message}`} /> : ' '}
              </div>
              <div class="brand-sub">{st ? [st.alias, st.locator].filter(Boolean).join(' · ') : ' '}</div>
            </div>
          </a>
          <button type="button" class="search" onClick={openPalette} aria-label={`Jump to a screen or command (${PALETTE_KEY})`} aria-keyshortcuts="Meta+K Control+K">
            <IconSearch />
            <span class="search-text">Jump to a screen or command</span>
            <kbd>{PALETTE_KEY}</kbd>
          </button>
          <div class="util">
            <button type="button" class="iconbtn" title="Switch to the other theme"
              aria-label={`Switch theme (now ${theme})`} aria-pressed={themeMode.value === 'opposite' ? 'true' : 'false'} onClick={toggleTheme}>
              <IconMoon />
            </button>
            <span class="me" title="Signed in as the node's sysop">
              <span class="avatar" aria-hidden="true">{me ? me.slice(0, 2) : ''}</span>
              <span class="me-call">{me ?? 'SysOp'}</span>
              <span class="role">SYSOP</span>
            </span>
            <button type="button" class="iconbtn" title="Sign out" aria-label="Sign out" onClick={doSignOut}>
              <IconSignOut />
            </button>
          </div>
        </header>

        {menu && <div class="side-scrim" onClick={() => setMenu(false)} aria-hidden="true" />}
        <Sidebar current={r} data={data} open={menu} onPick={() => setMenu(false)} />

        <main class="sys-main">
          {MAIL_SCREENS[r] ? MAIL_SCREENS[r]() : r === 'health' ? <Health /> : r === 'settings' ? <NodeSettings /> : PublicScreen ? (
            <>
              <div class="titlebar"><h1>{labelOf(r)}</h1></div>
              <PublicScreen />
            </>
          ) : COMING.includes(r) ? <ComingSoon route={r} /> : <Health />}
        </main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </ShellContext.Provider>
  );
}
