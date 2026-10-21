process.env.TZ = 'America/Los_Angeles';

import { render, screen, within, act, waitFor } from '@testing-library/preact';
import { Overview } from '../Overview';
import * as ui from '../../data/uiapi';
import * as api from '../../data/api';
import { expectNoOldPageLinks, prime } from './prime';
import { NOW, countsPartial, station } from './sample';

vi.mock('../../data/api', async () => (await import('./mocks')).MOCK_API());
vi.mock('../../data/uiapi', async () => (await import('./mocks')).MOCK_UI());
vi.mock('../../data/pages', async () => (await import('./mocks')).MOCK_PAGES());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  prime();
});
afterEach(() => vi.useRealTimers());

const portRow = (name: string): HTMLElement => screen.getByText(name, { selector: '.pname' }).closest('.port') as HTMLElement;

// /api/ui/events is sysop-only; no public page may call it.
afterEach(() => expect(vi.mocked(ui.getEvents)).not.toHaveBeenCalled());

test('hero reads Gateway on the air with the frequency and modes from the station', async () => {
  render(<Overview />);
  const hero = await screen.findByRole('region', { name: 'Node status' });
  expect(await within(hero).findByText('Gateway on the air')).toBeInTheDocument();
  expect(hero).toHaveTextContent('Winlink RMS on 145.630 MHz · VARA FM and 1200 baud packet');
  expect(within(hero).getByText('2d 04:17')).toBeInTheDocument();
  expect(within(hero).getByText('reachable')).toBeInTheDocument();
  expect(within(hero).getByText('6.0.26.1')).toBeInTheDocument();
});

test('hero does not claim on the air when no radio port is linked', async () => {
  vi.mocked(ui.getLinkStates).mockResolvedValue([
    { number: 1, state: 'unknown', detail: 'driver reports no link state' },
    { number: 3, state: 'down', detail: 'VARA modem not connected' },
    { number: 2, state: 'down', detail: 'KISS TCP not connected' },
  ]);
  render(<Overview />);
  const hero = await screen.findByRole('region', { name: 'Node status' });
  expect(await within(hero).findByText('Gateway down: radios not connected')).toBeInTheDocument();
  expect(within(hero).queryByText('Gateway on the air')).toBeNull();
  // the down ports' own details, in port order, then the frequency line
  expect(within(hero).getByText('VARA modem not connected · KISS TCP not connected')).toBeInTheDocument();
  expect(within(hero).getByText('Winlink RMS on 145.630 MHz · VARA FM and 1200 baud packet')).toBeInTheDocument();
});

test('hero on a node with no radio ports reads Node down when every port is down', async () => {
  vi.mocked(ui.getStation).mockResolvedValue({
    ...station, ports: station.ports.map((p) => ({ ...p, freqHz: null })),
  });
  vi.mocked(ui.getLinkStates).mockResolvedValue([
    { number: 1, state: 'down', detail: 'Telnet not listening' },
    { number: 3, state: 'down', detail: 'VARA modem not connected' },
    { number: 2, state: 'down', detail: 'VARA modem not connected' },
  ]);
  render(<Overview />);
  const hero = await screen.findByRole('region', { name: 'Node status' });
  expect(await within(hero).findByText('Node down: radios not connected')).toBeInTheDocument();
  // no frequency line on a node without radio ports; a detail two ports share is said once
  expect(Array.from(hero.querySelectorAll('.hero-text p')).map((p) => p.textContent))
    .toEqual(['Telnet not listening · VARA modem not connected']);
});

const axip = { number: 4, id: 'AXIP peer link', driver: 'BPQAXIP', freqHz: null, modes: [], addr: null, txtailMs: null };

test('an AXIP port sits under Internet links, not Radio ports', async () => {
  vi.mocked(ui.getStation).mockResolvedValue({ ...station, ports: [...station.ports, axip] });
  vi.mocked(ui.getLinkStates).mockResolvedValue([
    { number: 1, state: 'unknown', detail: 'driver reports no link state' },
    { number: 3, state: 'linked', detail: 'connected to VARA modem' },
    { number: 2, state: 'down', detail: 'KISS TCP not connected' },
    { number: 4, state: 'linked', detail: 'socket open, 1 of 1 peers heard in the last hour' },
  ]);
  render(<Overview />);
  const radio = await screen.findByRole('region', { name: 'Radio ports' });
  const inet = await screen.findByRole('region', { name: 'Internet links' });
  await within(radio).findByText('VARA FM', { selector: '.pname' });
  expect(within(radio).queryByText('AXIP peer link')).toBeNull();
  expect(within(inet).getByText('AXIP peer link', { selector: '.pname' })).toBeInTheDocument();
  const chip = await within(inet).findByText('Listening');
  expect(chip.closest('[title]')).toHaveAttribute('title', 'socket open, 1 of 1 peers heard in the last hour');
});

test('no Internet links card when the station has no AXIP port', async () => {
  render(<Overview />);
  await screen.findByRole('region', { name: 'Radio ports' });
  expect(screen.queryByRole('region', { name: 'Internet links' })).toBeNull();
});

test('a linked AXIP port does not put a node with every radio down on the air', async () => {
  vi.mocked(ui.getStation).mockResolvedValue({
    ...station, ports: [...station.ports.map((p) => ({ ...p, freqHz: null })), axip],
  });
  vi.mocked(ui.getLinkStates).mockResolvedValue([
    { number: 1, state: 'down', detail: 'Telnet not listening' },
    { number: 3, state: 'down', detail: 'VARA modem not connected' },
    { number: 2, state: 'down', detail: 'serial device not open' },
    { number: 4, state: 'linked', detail: 'socket open, 1 of 1 peers heard in the last hour' },
  ]);
  render(<Overview />);
  const hero = await screen.findByRole('region', { name: 'Node status' });
  expect(await within(hero).findByText('Node down: radios not connected')).toBeInTheDocument();
  expect(within(hero).getByText('Telnet not listening · VARA modem not connected · serial device not open')).toBeInTheDocument();
  expect(hero).not.toHaveTextContent('socket open');
});

test('port cards show addresses, TXTAIL and the telnet port from getStation', async () => {
  render(<Overview />);
  await screen.findByText('VARA FM', { selector: '.pname' });
  expect(portRow('VARA FM')).toHaveTextContent('145.630 MHz · VARAFM96 · TNC 127.0.0.1:8300');
  expect(portRow('Direwolf')).toHaveTextContent(':8001');
  expect(portRow('Direwolf')).toHaveTextContent('TXTAIL 100 ms');
  expect(portRow('Telnet Server')).toHaveTextContent('Telnet :8010');
  const order = Array.from(document.querySelectorAll('.pname')).map((e) => e.textContent);
  expect(order).toEqual(['VARA FM', 'Direwolf', 'Telnet Server']);
});

test('link state unknown renders Unknown with the reason, never Listening', async () => {
  render(<Overview />);
  await screen.findByText('Telnet Server', { selector: '.pname' });
  const chip = await within(portRow('Telnet Server')).findByText('Unknown');
  expect(chip.closest('[title]')).toHaveAttribute('title', 'driver reports no link state');
  expect(portRow('Telnet Server')).not.toHaveTextContent('Listening');
  expect(within(portRow('VARA FM')).getByText('Listening')).toBeInTheDocument();
  expect(within(portRow('Direwolf')).getByText('Down')).toBeInTheDocument();
});

test('counts tile reads Last 24 hours when the window is full', async () => {
  render(<Overview />);
  const tile = await screen.findByRole('region', { name: 'Last 24 hours' });
  expect(await within(tile).findByText('412')).toBeInTheDocument();
  expect(within(tile).getByText('7')).toBeInTheDocument();
});

test('counts tile reads Since <local time> while the window is filling', async () => {
  vi.mocked(ui.getCounts).mockResolvedValue(countsPartial);
  render(<Overview />);
  const tile = await screen.findByRole('region', { name: 'Since 09:12' });
  expect(within(tile).queryByText('Last 24 hours')).toBeNull();
});

test('held mail is Unknown on the public page, with the reason', async () => {
  render(<Overview />);
  const tile = await screen.findByRole('region', { name: 'Last 24 hours' });
  const held = within(tile).getByText('Held mail').closest('.stat') as HTMLElement;
  expect(within(held).getByText('Unknown')).toHaveAttribute('title', expect.stringMatching(/sign/i));
});

test('recently heard shows via only for a station heard through a digipeater', async () => {
  render(<Overview />);
  const card = await screen.findByRole('region', { name: /Recently heard/ });
  const n6ug = (await within(card).findByText('N6UG')).closest('li') as HTMLElement;
  const w6sar = within(card).getByText('W6SAR-10', { selector: '.call' }).closest('li') as HTMLElement;
  expect(n6ug).toHaveTextContent('Direwolf · via W6SAR-10');
  expect(w6sar).not.toHaveTextContent('via');
  expect(within(n6ug).getByText('17m')).toBeInTheDocument();
  const calls = within(card).getAllByText(/./, { selector: '.call' }).map((e) => e.textContent);
  expect(calls).toEqual(['W6SAR-10', 'N6UG', 'AD6DM']);
});

test('who is connected shows the empty state when nobody is', async () => {
  render(<Overview />);
  expect(await screen.findByText('Nobody is connected right now.')).toBeInTheDocument();
});

test('who is connected lists sessions when there are some', async () => {
  vi.mocked(api.getUsers).mockResolvedValue([{ Call: 'KN6HTD' }]);
  render(<Overview />);
  const card = await screen.findByRole('region', { name: "Who's connected" });
  expect(await within(card).findByText('KN6HTD')).toBeInTheDocument();
  expect(within(card).queryByText('Nobody is connected right now.')).toBeNull();
});

test('CMS state carries when it was last checked: a connect attempt, not a login', async () => {
  render(<Overview />);
  const hero = await screen.findByRole('region', { name: 'Node status' });
  const ok = await within(hero).findByText('reachable');
  expect(ok.closest('.v')).toHaveTextContent('reachable, checked 08:00');
  expect(ok.closest('[title]')?.getAttribute('title')).toBe('Last CMS connect attempt Oct 20 08:00. It tests the connection, not a login.');
});

test('an unreachable CMS checked on an earlier day shows the date', async () => {
  vi.mocked(ui.getCms).mockResolvedValue({ lastAttempt: '2026-10-19T20:05:00Z', lastSuccess: '2026-10-18T10:00:00Z', ok: false });
  render(<Overview />);
  const hero = await screen.findByRole('region', { name: 'Node status' });
  const down = await within(hero).findByText('unreachable');
  expect(down.closest('.v')).toHaveTextContent('unreachable, checked Oct 19 13:05');
  expect(down.closest('[title]')?.getAttribute('title')).toBe('Last CMS connect attempt Oct 19 13:05. Last reached Oct 18 03:00.');
});

test('CMS and uptime the node did not report render Unknown with a reason', async () => {
  vi.mocked(ui.getCms).mockResolvedValue({ lastAttempt: null, lastSuccess: null, ok: null });
  vi.mocked(ui.getStation).mockResolvedValue({ ...(await ui.getStation()), uptimeSec: null });
  render(<Overview />);
  const hero = await screen.findByRole('region', { name: 'Node status' });
  await within(hero).findByText('6.0.26.1');
  const unknowns = within(hero).getAllByText('Unknown');
  expect(unknowns).toHaveLength(2);
  for (const u of unknowns) expect(u.getAttribute('title')).toBeTruthy();
});

test('footer shows the version, public name and update time', async () => {
  render(<Overview />);
  const footer = await screen.findByRole('contentinfo');
  expect(await within(footer).findByText('LinBPQ 6.0.26.1')).toBeInTheDocument();
  expect(footer).toHaveTextContent('BarBPQ - LinBPQ Web UI');
  await waitFor(() => expect(footer).toHaveTextContent('Updated 10:00'));
});

test('nothing on the overview links to an old page', async () => {
  const { container } = render(<Overview />);
  await screen.findByText('N6UG');
  expectNoOldPageLinks(container);
});

test('an offline banner appears after the polls go stale', async () => {
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  render(<Overview />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.queryByRole('alert')).toBeNull();
  vi.mocked(ui.getStation).mockRejectedValue(new Error('down'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByRole('alert')).toHaveTextContent(/can.t reach the node/i);
  expect(screen.getByText('VARA FM', { selector: '.pname' })).toBeInTheDocument();
});

const never = <T,>(): Promise<T> => new Promise<T>(() => {});

test('counts card is titled Counts while loading, with loading placeholders that say so', async () => {
  vi.mocked(ui.getCounts).mockImplementation(never);
  render(<Overview />);
  const tile = await screen.findByRole('region', { name: 'Counts' });
  expect(within(tile).getAllByRole('img', { name: 'Loading' })).toHaveLength(3);
  expect(screen.queryByRole('region', { name: 'Last 24 hours' })).toBeNull();
});

test('counts card stays Counts on error, values Unknown with the error as reason', async () => {
  vi.mocked(ui.getCounts).mockRejectedValue(new Error('/api/ui/counts answered 500'));
  render(<Overview />);
  const tile = await screen.findByRole('region', { name: 'Counts' });
  await waitFor(() => expect(within(tile).getAllByText('Unknown')).toHaveLength(4));
  const sessions = within(tile).getByText('Sessions').closest('.stat') as HTMLElement;
  expect(within(sessions).getByText('Unknown')).toHaveAttribute('title', '/api/ui/counts answered 500');
  expect(within(tile).queryAllByRole('img', { name: 'Loading' })).toHaveLength(0);
});

test('a failed station poll shows Status unknown and Unknown facts with the reason, not skeletons', async () => {
  vi.mocked(ui.getStation).mockRejectedValue(new Error('/api/ui/station answered 404'));
  render(<Overview />);
  const hero = await screen.findByRole('region', { name: 'Node status' });
  expect(await within(hero).findByText('Status unknown')).toBeInTheDocument();
  const unknowns = within(hero).getAllByText('Unknown').filter((u) => u.getAttribute('title') === '/api/ui/station answered 404');
  expect(unknowns).toHaveLength(2);
  expect(within(hero).queryAllByRole('img', { name: 'Loading' })).toHaveLength(0);
});

test('a failed link-state poll gives Unknown chips with the reason and no on-the-air claim', async () => {
  vi.mocked(ui.getLinkStates).mockRejectedValue(new Error('/api/ui/links answered 500'));
  vi.mocked(ui.getCms).mockRejectedValue(new Error('/api/ui/cms answered 500'));
  render(<Overview />);
  await screen.findByText('VARA FM', { selector: '.pname' });
  const chip = await within(portRow('VARA FM')).findByText('Unknown');
  expect(chip.closest('[title]')).toHaveAttribute('title', '/api/ui/links answered 500');
  const hero = screen.getByRole('region', { name: 'Node status' });
  expect(within(hero).getByText('Gateway status unknown')).toBeInTheDocument();
  await waitFor(() => expect(within(hero).getByText('Unknown')).toHaveAttribute('title', '/api/ui/cms answered 500'));
});

test('loading link states show a labelled placeholder, not a chip', async () => {
  vi.mocked(ui.getLinkStates).mockImplementation(never);
  render(<Overview />);
  await screen.findByText('VARA FM', { selector: '.pname' });
  expect(within(portRow('VARA FM')).getByRole('img', { name: 'Loading' })).toBeInTheDocument();
});

test('the heard list reuses the station poll: one station request', async () => {
  render(<Overview />);
  await screen.findByText('N6UG');
  expect(ui.getStation).toHaveBeenCalledTimes(1);
  expect(ui.getHeard).toHaveBeenCalledTimes(3);
});
