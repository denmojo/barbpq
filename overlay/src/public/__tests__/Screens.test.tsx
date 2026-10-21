process.env.TZ = 'America/Los_Angeles';

import { render, screen, within, fireEvent } from '@testing-library/preact';
import { Ports } from '../Ports';
import { Heard } from '../Heard';
import { LinksRoutes } from '../LinksRoutes';
import { Sessions } from '../Sessions';
import * as api from '../../data/api';
import * as pages from '../../data/pages';
import { ParseError } from '../../data/http';
import * as ui from '../../data/uiapi';
import { expectNoOldPageLinks, prime } from './prime';
import { NOW } from './sample';

vi.mock('../../data/api', async () => (await import('./mocks')).MOCK_API());
vi.mock('../../data/uiapi', async () => (await import('./mocks')).MOCK_UI());
vi.mock('../../data/pages', async () => (await import('./mocks')).MOCK_PAGES());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  prime();
});
afterEach(() => vi.useRealTimers());

const rowOf = (text: string): HTMLElement => screen.getByText(text).closest('tr') as HTMLElement;

// /api/ui/events is sysop-only; no public page may call it.
afterEach(() => expect(vi.mocked(ui.getEvents)).not.toHaveBeenCalled());

describe('Ports', () => {
  test('lists every port with frequency, address, TXTAIL and link state', async () => {
    const { container } = render(<Ports />);
    await screen.findByText('VARA FM');
    expect(rowOf('VARA FM')).toHaveTextContent('145.630 MHz');
    expect(rowOf('VARA FM')).toHaveTextContent('127.0.0.1:8300');
    expect(rowOf('VARA FM')).toHaveTextContent('Listening');
    expect(rowOf('Direwolf')).toHaveTextContent('100 ms');
    expect(rowOf('Direwolf')).toHaveTextContent('Down');
    expect(rowOf('Telnet Server')).toHaveTextContent(':8010');
    expectNoOldPageLinks(container);
  });

  test('values the node did not report are Unknown with a reason, never Listening', async () => {
    render(<Ports />);
    await screen.findByText('Telnet Server');
    const telnet = rowOf('Telnet Server');
    expect(telnet).not.toHaveTextContent('Listening');
    const unknowns = within(telnet).getAllByText('Unknown');
    expect(unknowns.length).toBeGreaterThanOrEqual(2);
    for (const u of unknowns) expect(u.closest('[title]')?.getAttribute('title')).toBeTruthy();
  });
});

describe('Heard', () => {
  test('merges every port newest first and shows via only when there is a path', async () => {
    render(<Heard />);
    await screen.findByText('N6UG');
    const calls = Array.from(document.querySelectorAll('tbody .call')).map((e) => e.textContent);
    expect(calls).toEqual(['W6SAR-10', 'N6UG', 'AD6DM']);
    expect(rowOf('N6UG')).toHaveTextContent('via W6SAR-10');
    expect(screen.getByText('W6SAR-10', { selector: 'tbody .call' }).closest('tr')).not.toHaveTextContent('via');
    expect(rowOf('N6UG')).toHaveTextContent('09:43');
  });

  test('a port tab narrows the list to that port', async () => {
    render(<Heard />);
    await screen.findByText('N6UG');
    fireEvent.click(screen.getByRole('tab', { name: 'VARA FM' }));
    expect(screen.getByText('AD6DM')).toBeInTheDocument();
    expect(screen.queryByText('N6UG')).toBeNull();
    expect(screen.getByRole('tab', { name: 'VARA FM' })).toHaveAttribute('aria-selected', 'true');
  });

  test('empty ports show an empty state', async () => {
    render(<Heard />);
    await screen.findByText('N6UG');
    fireEvent.click(screen.getByRole('tab', { name: 'Telnet Server' }));
    expect(screen.getByText('Nothing heard on this port yet.')).toBeInTheDocument();
  });
});

describe('Links & routes', () => {
  test('shows links, neighbours and nodes', async () => {
    const { container } = render(<LinksRoutes />);
    const linksCard = await screen.findByRole('region', { name: 'Links' });
    expect(await within(linksCard).findByText('W6SAR-10')).toBeInTheDocument();
    expect(linksCard).toHaveTextContent('Connected');
    const nb = screen.getByRole('region', { name: 'Neighbours' });
    expect(await within(nb).findByText('W6SAR-10')).toBeInTheDocument();
    expect(nb).toHaveTextContent('192');
    const nodes = screen.getByRole('region', { name: 'Nodes' });
    expect(await within(nodes).findByText('SARNOD')).toBeInTheDocument();
    expectNoOldPageLinks(container);
  });

  test('a routes parse failure shows an error card naming the page; the rest still renders', async () => {
    vi.mocked(pages.fetchRoutes).mockRejectedValue(new ParseError('Routes', 'routes table'));
    vi.mocked(api.getLinks).mockResolvedValue([]);
    render(<LinksRoutes />);
    const nb = await screen.findByRole('region', { name: 'Neighbours' });
    expect(await within(nb).findByText('Could not read routes table from Routes')).toBeInTheDocument();
    expect(await screen.findByText('No links are up right now.')).toBeInTheDocument();
    expect(await screen.findByText('SARNOD')).toBeInTheDocument();
  });
});

describe('Sessions', () => {
  test('shows the empty state when nobody is connected', async () => {
    render(<Sessions />);
    expect(await screen.findByText('Nobody is connected right now.')).toBeInTheDocument();
  });

  test('lists connected stations', async () => {
    vi.mocked(api.getUsers).mockResolvedValue([{ Call: 'KN6HTD' }, { Call: 'N6UG' }]);
    render(<Sessions />);
    expect(await screen.findByText('KN6HTD')).toBeInTheDocument();
    expect(screen.getByText('N6UG')).toBeInTheDocument();
    expect(screen.queryByText('Nobody is connected right now.')).toBeNull();
  });
});
