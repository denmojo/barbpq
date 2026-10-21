import { signal } from '@preact/signals';

export const ROUTES = [
  'overview', 'ports', 'heard', 'links', 'sessions', 'health', 'messages',
  'forwarding', 'bbsusers', 'housekeeping', 'mailsettings', 'settings', 'console', 'logs',
] as const;
export type Route = (typeof ROUTES)[number];

export function parseHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'overview';
}

export const route = signal<Route>(parseHash(location.hash));

export function syncRoute(): void {
  route.value = parseHash(location.hash);
}

export function navigate(r: Route): void {
  location.hash = `#/${r}`;
  route.value = r;
}

window.addEventListener('hashchange', syncRoute);
