import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import { fixture, stubFetch } from '../../data/__tests__/helpers';
import { sysop } from '../../data/session';
import { expectNoOldPageLinks } from '../../public/__tests__/prime';
import { NOW } from '../../public/__tests__/sample';
import { Logs } from '../Logs';

const MENU = fixture('node-signon.html');
const BBS = fixture('node-showlog-bbs.html');
const MISSING = fixture('node-showlog-missing.html');
const url = (date: string, q: string) => `/node/ShowLog.html?date=${date}&${q}`;

let setItem: ReturnType<typeof vi.spyOn>;
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setItem = vi.spyOn(Storage.prototype, 'setItem');
  for (const m of ['log', 'info', 'debug', 'warn', 'error'] as const) consoleSpies.push(vi.spyOn(console, m));
  sysop.value = 'in';
});
afterEach(() => {
  // Logs can carry secrets too: never stored, never logged.
  expect(setItem).not.toHaveBeenCalled();
  for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
  setItem.mockRestore();
  for (const s of consoleSpies.splice(0)) s.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sysop.value = 'unknown';
});

test('Logs lists the node log files for the UTC day and opens one', async () => {
  const calls = stubFetch({
    '/Node/NodeMenu.html': MENU,
    [url('2026-10-20', 'BBS=BBS+Log')]: BBS,
  });
  const { container } = render(<Logs />);
  const list = await screen.findByRole('list', { name: 'Log files' });
  expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
    'Node Debug Log', 'BBS Log', 'BBS Debug Log', 'Telnet Log', 'CMS Log', 'Chat Log',
  ]);
  expect((screen.getByLabelText('Day (UTC)') as HTMLInputElement).value).toBe('2026-10-20');
  fireEvent.click(within(list).getByRole('button', { name: 'BBS Log' }));
  const text = await screen.findByRole('region', { name: 'BBS Log, 2026-10-20' });
  expect(text).toHaveTextContent('Routing Trace - No Match');
  expect(text).toHaveTextContent('API Connect from');
  expect(screen.getByText('9 lines')).toBeInTheDocument();
  expect(calls.map((c) => c.url)).toEqual(['/Node/NodeMenu.html', url('2026-10-20', 'BBS=BBS+Log')]);
  expectNoOldPageLinks(container);
});

test('search keeps the matching lines and marks the match', async () => {
  stubFetch({ '/Node/NodeMenu.html': MENU, [url('2026-10-20', 'BBS=BBS+Log')]: BBS });
  render(<Logs />);
  fireEvent.click(await screen.findByRole('button', { name: 'BBS Log' }));
  const region = await screen.findByRole('region', { name: 'BBS Log, 2026-10-20' });
  fireEvent.input(screen.getByRole('searchbox', { name: 'Search this log' }), { target: { value: 'mail starting' } });
  await waitFor(() => expect(screen.getByText('3 of 9 lines')).toBeInTheDocument());
  expect(region.querySelectorAll('mark')).toHaveLength(3);
  expect(region).not.toHaveTextContent('API Connect');
});

test('changing the day re-reads the open log', async () => {
  const calls = stubFetch({
    '/Node/NodeMenu.html': MENU,
    [url('2026-10-20', 'BBS=BBS+Log')]: BBS,
    [url('2026-10-19', 'BBS=BBS+Log')]: BBS,
  });
  render(<Logs />);
  fireEvent.click(await screen.findByRole('button', { name: 'BBS Log' }));
  await screen.findByRole('region', { name: 'BBS Log, 2026-10-20' });
  fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
  await screen.findByRole('region', { name: 'BBS Log, 2026-10-19' });
  expect(calls.map((c) => c.url)).toContain(url('2026-10-19', 'BBS=BBS+Log'));
});

test('a day with no file says so instead of showing the node message as log text', async () => {
  stubFetch({ '/Node/NodeMenu.html': MENU, [url('2026-10-20', 'CMS=CMS+Log')]: MISSING });
  render(<Logs />);
  fireEvent.click(await screen.findByRole('button', { name: 'CMS Log' }));
  expect(await screen.findByText('No CMS Log for 2026-10-20')).toBeInTheDocument();
  expect(screen.queryByText(/CMSAccess_/)).toBeNull();
});

test('a menu the parser cannot read shows the error, not an empty list', async () => {
  stubFetch({ '/Node/NodeMenu.html': '<html></html>' });
  render(<Logs />);
  expect(await screen.findByText(/View Logs form/)).toBeInTheDocument();
});
