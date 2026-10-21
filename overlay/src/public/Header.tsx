import { Lock, Mail, Moon } from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Info } from '../data/api';
import type { Poll } from '../data/poll';
import { navigate, type Route } from '../app/router';
import { effectiveTheme, systemDark, themeMode, toggleTheme } from '../ui/theme';
import { Unknown } from '../ui/Unknown';

export const PUBLIC_TABS: { route: Route; label: string }[] = [
  { route: 'overview', label: 'Overview' },
  { route: 'ports', label: 'Ports' },
  { route: 'heard', label: 'Heard' },
  { route: 'links', label: 'Links & routes' },
  { route: 'sessions', label: 'Sessions' },
];

const WEBMAIL_TIP = 'Coming in the next release';

export function Header({ info, current }: { info: Poll<Info>; current: Route }) {
  const d = info.data;
  void systemDark.value; // re-render when the OS theme changes
  const opposite = themeMode.value === 'opposite';
  const theme = effectiveTheme();
  const nav = useRef<HTMLElement>(null);
  // On a phone the tab row scrolls; keep the current tab in view.
  useEffect(() => {
    nav.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  return (
    <header class="hdr">
      <div class="brand">
        <div class="logo" aria-hidden="true">{d ? d.Alias.slice(0, 2) : ''}</div>
        <div class="brand-text">
          <div class="brand-name">
            {d ? d.NodeCall : info.error ? <Unknown reason={`The node did not answer: ${info.error.message}`} /> : ' '}
          </div>
          <div class="brand-sub">{d ? [d.Alias, d.Locator].filter(Boolean).join(' · ') : ' '}</div>
        </div>
      </div>
      <nav class="primary" aria-label="Main navigation" ref={nav}>
        {PUBLIC_TABS.map((t) => (
          <a href={`#/${t.route}`} aria-current={t.route === current ? 'page' : undefined}>{t.label}</a>
        ))}
      </nav>
      <div class="util">
        <button type="button" class="iconbtn" title="Switch to the other theme"
          aria-label={`Switch theme (now ${theme})`} aria-pressed={opposite ? 'true' : 'false'} onClick={toggleTheme}>
          <Moon aria-hidden="true" />
        </button>
        <span class="tip" title={WEBMAIL_TIP}>
          <button type="button" class="btn" disabled title={WEBMAIL_TIP} aria-label="Webmail">
            <Mail aria-hidden="true" />
            <span class="lbl">Webmail</span>
          </button>
        </span>
        <button type="button" class="btn primary" aria-label="SysOp sign in" title="SysOp sign in" onClick={() => navigate('health')}>
          <Lock aria-hidden="true" />
          <span class="lbl">SysOp sign in</span>
        </button>
      </div>
    </header>
  );
}
