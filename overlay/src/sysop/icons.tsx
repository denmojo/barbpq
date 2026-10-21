// Sidebar and header icons, drawn inline from the approved mockup (sysop-home-v2.html).
import type { JSX } from 'preact';

const svg = (children: JSX.Element | JSX.Element[]) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconHealth = () => svg(<path d="M3 12h4l3-8 4 16 3-8h4" />);
export const IconPorts = () => svg([<path d="M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0" />, <circle cx="12" cy="12" r="1" />]);
export const IconHeard = () => svg(<path d="M4 6h16M4 12h10M4 18h6" />);
export const IconLinks = () => svg([<circle cx="6" cy="6" r="2" />, <circle cx="18" cy="18" r="2" />, <path d="M8 6h5a3 3 0 0 1 3 3v7" />]);
export const IconSessions = () => svg([<circle cx="9" cy="8" r="3" />, <path d="M3 20a6 6 0 0 1 12 0" />]);
export const IconMessages = () => svg([<rect x="3" y="5" width="18" height="14" rx="2" />, <path d="m3 7 9 6 9-6" />]);
export const IconForwarding = () => svg(<path d="M4 12h12M12 6l6 6-6 6" />);
export const IconUsers = () => svg([<circle cx="12" cy="8" r="3.5" />, <path d="M5 20a7 7 0 0 1 14 0" />]);
export const IconHousekeeping = () => svg([<path d="M12 3v3M12 18v3M3 12h3M18 12h3" />, <circle cx="12" cy="12" r="4" />]);
export const IconSettings = () => svg([<path d="M4 7h10M4 17h6M14 7h6M10 17h10" />, <circle cx="14" cy="7" r="2" />, <circle cx="10" cy="17" r="2" />]);
export const IconConsole = () => svg(<path d="m5 8 4 4-4 4M11 16h8" />);
export const IconLogs = () => svg([<path d="M6 3h9l3 3v15H6z" />, <path d="M9 11h6M9 15h6" />]);
export const IconSearch = () => svg([<circle cx="11" cy="11" r="7" />, <path d="m20 20-3.5-3.5" />]);
export const IconMoon = () => svg(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);
export const IconMenu = () => svg(<path d="M4 6h16M4 12h16M4 18h16" />);
export const IconSignOut = () => svg([<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />, <path d="M10 17l-5-5 5-5M5 12h11" />]);
export const IconLock = () => svg([<rect x="5" y="11" width="14" height="10" rx="2" />, <path d="M8 11V8a4 4 0 0 1 8 0v3" />]);
