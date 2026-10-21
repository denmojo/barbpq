process.env.TZ = 'America/Los_Angeles';

import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/preact';
import { SysopLayout } from '../SysopLayout';
import { App } from '../../app/App';
import { route } from '../../app/router';
import { sysop } from '../../data/session';
import * as ui from '../../data/uiapi';
import * as api from '../../data/api';
import type { UiEvent } from '../../data/uiapi';
import { parseMailKey } from '../../data/pages';
import { fixture, stubFetch } from '../../data/__tests__/helpers';
import { expectNoOldPageLinks, prime } from '../../public/__tests__/prime';
import { NOW } from '../../public/__tests__/sample';
import { pendingCommand } from '../consoleproto';
import { paletteItems } from '../palette';
import { FakeWS } from './fakews';

vi.mock('../../data/api', async () => (await import('../../public/__tests__/mocks')).MOCK_API());
vi.mock('../../data/uiapi', async () => (await import('../../public/__tests__/mocks')).MOCK_UI());
vi.mock('../../data/pages', async () => ({
  ...(await vi.importActual<object>('../../data/pages')),
  fetchRoutes: vi.fn(), fetchStats: vi.fn(),
}));

const KEY = parseMailKey(fixture('mail-header.html'));
const mailPages = (over: Record<string, string> = {}) => stubFetch({
  '/Mail/Header': fixture('mail-header.html'),
  [`/Mail/Status?${KEY}`]: fixture('mail-status.html'),
  [`/Mail/FwdList.txt?${KEY}`]: fixture('mail-fwdlist.txt'),
  [`/Mail/FwdDetails?${KEY}`]: fixture('mail-fwddetails-rms.html'),
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  prime();
  vi.mocked(ui.getLinkStates).mockResolvedValue([
    { number: 1, state: 'unknown', detail: 'driver reports no link state' },
    { number: 3, state: 'down', detail: 'VARA modem not connected' },
    { number: 2, state: 'down', detail: 'KISS TCP not connected' },
  ]);
  vi.mocked(ui.getEvents).mockImplementation(async (limit?: number) => ([
    { t: '2026-10-20T16:58:00Z', kind: 'forward', detail: { route: 'RMS via port 1', cmsReachable: true } },
    { t: '2026-10-20T16:30:00Z', kind: 'cfgsave', detail: {} },
    { t: '2026-10-20T16:20:00Z', kind: 'forward', detail: { route: 'RMS via port 1', cmsReachable: false } },
    { t: '2026-10-20T13:30:00Z', kind: 'restart', detail: {} },
  ] as UiEvent[]).slice(0, limit));
  mailPages();
  sysop.value = 'in';
  location.hash = '#/health';
  route.value = 'health';
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sysop.value = 'unknown';
});

const card = (name: string): HTMLElement =>
  within(screen.getByRole('list', { name: 'Health checks' })).getByText(name).closest('li') as HTMLElement;

test('health strip: five cards from link states, CMS, mail Status and the RMS forwarding form', async () => {
  render(<SysopLayout />);
  const strip = await screen.findByRole('list', { name: 'Health checks' });
  await waitFor(() => expect(card('Store and forward')).toHaveTextContent('Armed'));
  expect(Array.from(strip.querySelectorAll('.k')).map((k) => k.textContent))
    .toEqual(['VARA FM', 'Dire Wolf', 'Winlink CMS', 'BBS', 'Store and forward']);
  await waitFor(() => expect(card('VARA FM')).toHaveTextContent('Down'));
  expect(card('VARA FM')).toHaveTextContent('TNC :8300');
  expect(card('VARA FM')).toHaveClass('down');
  expect(card('Dire Wolf')).toHaveTextContent('Down');
  expect(card('Dire Wolf')).toHaveTextContent('KISS :8001 · TXTAIL 100 ms');
  expect(card('Winlink CMS')).toHaveTextContent('Reachable');
  expect(card('Winlink CMS')).toHaveTextContent('last login 08:00');
  await waitFor(() => expect(card('BBS')).toHaveTextContent('Running'));
  expect(card('BBS')).toHaveTextContent('AD6DM · 0 users');
  expect(card('Store and forward')).toHaveTextContent('Last used Oct 20 09:20');
});

test('store and forward reads Never used without a forward run while CMS was unreachable', async () => {
  vi.mocked(ui.getEvents).mockResolvedValue([{ t: '2026-10-20T16:58:00Z', kind: 'forward', detail: { cmsReachable: true } }]);
  render(<SysopLayout />);
  await waitFor(() => expect(card('Store and forward')).toHaveTextContent('Never used'));
  expect(card('Store and forward')).toHaveTextContent('Armed');
});

test('store and forward: an RMS run the node logged with no CMS result shows Unknown, not Never used, with the reason as a tooltip', async () => {
  vi.mocked(ui.getEvents).mockResolvedValue([{ t: '2026-10-20T16:58:00Z', kind: 'forward', detail: { route: 'RMS via port 1', cmsReachable: null } }]);
  render(<SysopLayout />);
  await waitFor(() => expect(card('Store and forward')).toHaveTextContent('Unknown'));
  expect(card('Store and forward')).not.toHaveTextContent('Never used');
  expect(within(card('Store and forward')).getByText('Unknown')).toHaveAttribute('title', expect.stringContaining('logged no CMS result'));
});

test('CMS with no attempt yet is Unknown with a reason, never Reachable', async () => {
  vi.mocked(ui.getCms).mockResolvedValue({ lastAttempt: null, lastSuccess: null, ok: null });
  render(<SysopLayout />);
  await waitFor(() => expect(within(card('Winlink CMS')).getByText('Unknown')).toHaveAttribute('title', 'No CMS connect attempt since the node started'));
});

test('outage route shows the hops from the RMS connect script in order', async () => {
  render(<SysopLayout />);
  const hops = await screen.findByRole('list', { name: 'Forwarding tries in order' });
  await waitFor(() => expect(hops).toHaveTextContent('BBS AD6DM'));
  const items = Array.from(hops.querySelectorAll('.hop')).map((h) => [h.querySelector('.n')?.textContent, h.querySelector('.s')?.textContent]);
  expect(items).toEqual([
    ['BBS AD6DM', 'when CMS is unreachable'],
    ['CMS via internet', 'Telnet port 1'],
    ['W6SAR-10', 'Packet port 2'],
  ]);
  expect(screen.getByText('Every 30 min while mail is held · sends new mail at once')).toBeInTheDocument();
});

test('recent changes lists the first 10 of the single getEvents(200) poll, newest first', async () => {
  render(<SysopLayout />);
  const region = await screen.findByRole('region', { name: 'Recent changes' });
  await waitFor(() => expect(region.querySelectorAll('li')).toHaveLength(4));
  expect(vi.mocked(ui.getEvents).mock.calls).toEqual([[200]]);
  expect(Array.from(region.querySelectorAll('time')).map((t) => t.textContent)).toEqual(['09:58', '09:30', '09:20', '06:30']);
  expect(region).toHaveTextContent('Forwarded via RMS via port 1 while CMS was unreachable');
  expect(region).toHaveTextContent('Node restarted');
});

test('recent changes: a forward run with no CMS result is neutral and says the result is unknown, with the reason', async () => {
  vi.mocked(ui.getEvents).mockResolvedValue([
    { t: '2026-10-20T16:58:00Z', kind: 'forward', detail: { route: 'RMS via port 1', cmsReachable: null } },
    { t: '2026-10-20T16:50:00Z', kind: 'forward', detail: { route: 'RMS via port 1', cmsReachable: true } },
  ]);
  render(<SysopLayout />);
  const region = await screen.findByRole('region', { name: 'Recent changes' });
  await waitFor(() => expect(region.querySelectorAll('li')).toHaveLength(2));
  const items = Array.from(region.querySelectorAll('li'));
  const unknown = items[0] as HTMLElement;
  const reached = items[1] as HTMLElement;
  expect(unknown).toHaveTextContent('Forwarded via RMS via port 1, CMS result Unknown');
  expect(unknown.querySelector('.ic')).toHaveClass('idle');
  expect(unknown.querySelector('.ic')).not.toHaveClass('ok');
  expect(within(unknown).getByText('Unknown')).toHaveAttribute('title',
    'This run logged no CMS result within the node\'s wait, so whether it fell back is not known');
  expect(reached).toHaveTextContent(/^\d\d:\d\dForwarded via RMS via port 1$/);
  expect(reached.querySelector('.ic')).toHaveClass('ok');
});

test('mail card shows queued for RMS, held and messages', async () => {
  render(<SysopLayout />);
  const region = await screen.findByRole('region', { name: 'Mail' });
  await waitFor(() => expect(region).toHaveTextContent('Queued for RMS0'));
  expect(region).toHaveTextContent('Held1');
  expect(region).toHaveTextContent('Messages4');
});

test('sidebar: Health, Network, Mail, System, SYSOP badge, nothing links an old page', async () => {
  const { container } = render(<SysopLayout />);
  const nav = screen.getByRole('complementary', { name: 'SysOp navigation' });
  expect(Array.from(nav.querySelectorAll('.navh')).map((n) => n.textContent)).toEqual(['Network', 'Mail', 'System']);
  expect(Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([
    '#/health', '#/ports', '#/heard', '#/links', '#/sessions', '#/messages', '#/forwarding', '#/bbsusers',
    '#/housekeeping', '#/mailsettings', '#/settings', '#/console', '#/logs',
  ]);
  expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Health');
  expect(screen.getByText('SYSOP')).toBeInTheDocument();
  await screen.findByText('AD6DM');
  expectNoOldPageLinks(container);
});

test('recent changes stops at 10 entries of the 200-event poll', async () => {
  vi.mocked(ui.getEvents).mockResolvedValue(Array.from({ length: 30 }, (_, i) => (
    { t: new Date(Date.UTC(2026, 9, 20, 16, 59) - i * 60_000).toISOString(), kind: 'restart', detail: {} } as UiEvent)));
  render(<SysopLayout />);
  const region = await screen.findByRole('region', { name: 'Recent changes' });
  await waitFor(() => expect(region.querySelectorAll('li')).toHaveLength(10));
  expect(region.querySelector('time')).toHaveTextContent('09:59');
});

test('console and logs open their own screens, with the footer', async () => {
  vi.stubGlobal('WebSocket', FakeWS);
  route.value = 'console';
  const { container, unmount } = render(<SysopLayout />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Console');
  expect(screen.getByRole('log', { name: 'Console output' })).toBeInTheDocument();
  expect(container.querySelector('footer.foot')).toHaveTextContent('BarBPQ - LinBPQ Web UI');
  unmount();
  route.value = 'logs';
  render(<SysopLayout />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Logs');
  expect(screen.queryByText('Coming in this release.')).toBeNull();
});

test('health: the Console card sits beside Recent changes and its pills type a read-only command', async () => {
  render(<SysopLayout />);
  const con = await screen.findByRole('region', { name: 'Console' });
  expect(con).toHaveClass('span-7');
  expect(screen.getByRole('region', { name: 'Recent changes' })).toHaveClass('span-5');
  expect(con.querySelector('.term')).not.toBeNull();
  expect(within(con).getByRole('link', { name: 'Open full →' })).toHaveAttribute('href', '#/console');
  fireEvent.click(within(con).getByRole('button', { name: 'PORTS' }));
  expect(route.value).toBe('console');
  expect(pendingCommand.value).toBe('PORTS');
  pendingCommand.value = null;
});

test('health has no node-state shortcuts: no Restart node, no Test CMS now (the gateway runs unsupervised)', async () => {
  render(<SysopLayout />);
  await screen.findByRole('region', { name: 'Console' });
  expect(screen.queryByRole('button', { name: /Restart/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Test CMS/ })).toBeNull();
  expect(screen.queryByText('RESTART')).toBeNull();
});

test('the palette carries console commands that type into the console', async () => {
  render(<SysopLayout />);
  const item = paletteItems().find((i) => i.label === 'Console: list commands (?)');
  expect(item?.group).toBe('Console');
  act(() => item?.action?.());
  expect(route.value).toBe('console');
  expect(pendingCommand.value).toBe('?');
  pendingCommand.value = null;
  expect(paletteItems().some((i) => /RESTART|REBOOT|STARTCMS/i.test(i.label))).toBe(false);
});

test('the sysop document title is the call from /api/info and the public name', async () => {
  vi.mocked(api.getInfo).mockClear();
  render(<SysopLayout />);
  await waitFor(() => expect(document.title).toBe('AD6DM-11 · BarBPQ - LinBPQ Web UI'));
  expect(api.getInfo).toHaveBeenCalledTimes(1);
});

test('the shell reads /api/info once on mount, not on a timer', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
  vi.mocked(api.getInfo).mockClear();
  render(<SysopLayout />);
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
  expect(api.getInfo).toHaveBeenCalledTimes(1);
  expect(document.title).toBe('AD6DM-11 · BarBPQ - LinBPQ Web UI');
});

test('⌘K opens the palette, arrows move, Enter navigates, Escape closes', async () => {
  render(<SysopLayout />);
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  const box = screen.getByRole('combobox');
  expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  expect(document.activeElement).toBe(box);
  fireEvent.input(box, { target: { value: 'go to mail' } });
  const opts = screen.getAllByRole('option');
  expect(opts.map((o) => o.textContent)).toEqual(['Messages', 'Forwarding', 'BBS users', 'Housekeeping', 'Mail settings']);
  expect(opts[0]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  expect(box).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1]!.id);
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(route.value).toBe('forwarding');
  expect(location.hash).toBe('#/forwarding');
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the search pill opens the palette too', () => {
  render(<SysopLayout />);
  fireEvent.click(screen.getByRole('button', { name: /Jump to a screen or command/ }));
  expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
});

test('signed out, a sysop route shows sign-in; signing in brings the shell; signing out returns to public', async () => {
  sysop.value = 'out';
  mailPages({ '/Node/Signon?Node': fixture('node-signon.html') });
  render(<App />);
  expect(screen.getByRole('heading', { name: 'SysOp sign in' })).toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: 'SysOp navigation' })).toBeNull();
  fireEvent.input(screen.getByLabelText('User'), { target: { value: 'sysop' } });
  fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'staging' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('complementary', { name: 'SysOp navigation' })).toBeInTheDocument();
  expect(route.value).toBe('health');
  document.cookie = 'BPQSessionCookie=N0000ABCD; Path=/';
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); });
  expect(sysop.value).toBe('out');
  expect(document.cookie).not.toContain('BPQSessionCookie');
  expect(route.value).toBe('overview');
  expect(screen.getByRole('button', { name: /SysOp sign in/ })).toBeInTheDocument();
});

test('a session that expires while signed in drops back to the sign-in screen', async () => {
  mailPages({ [`/Mail/Status?${KEY}`]: '<form action=/Mail/Signon?Mail></form>' });
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'SysOp sign in' })).toBeInTheDocument();
  expect(sysop.value).toBe('out');
});
