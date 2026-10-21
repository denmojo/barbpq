import { getInfo, getPorts, getUsers, getLinks, getNodes } from '../api';
import { getStation, getLinkStates, getCms, getCounts, getHeard, getEvents } from '../uiapi';
import { parseLooseJson } from '../http';
import { fixture, stubFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

test('node API wrappers read the live fixtures, including the node empty-list quirks', async () => {
  stubFetch({
    '/api/info': fixture('api-info.json'),
    '/api/ports': fixture('api-ports.json'),
    '/api/users': fixture('api-users.json'),
    '/api/links': fixture('api-links.json'),
    '/api/nodes': fixture('api-nodes.json'),
  });
  expect((await getInfo()).NodeCall).toBe('AD6DM-11');
  const ports = await getPorts();
  expect(ports.map((p) => p.Number)).toEqual([1, 3, 2]);
  expect(await getUsers()).toEqual([]);
  expect(await getLinks()).toEqual([]);
  expect(await getNodes()).toEqual([]);
});

test('parseLooseJson drops trailing commas but leaves string contents alone', () => {
  const v = parseLooseJson('{"nodes":[\r\n {"Call":"A,]B", "Routes":[{"Port":1,},],},\r\n]}') as {
    nodes: { Call: string; Routes: unknown[] }[];
  };
  expect(v.nodes[0]?.Call).toBe('A,]B');
  expect(v.nodes[0]?.Routes).toHaveLength(1);
});

test('uiapi wrappers match the fork JSON', async () => {
  const calls = stubFetch({
    '/api/ui/station': fixture('ui-station.json'),
    '/api/ui/links': fixture('ui-links.json'),
    '/api/ui/cms': fixture('ui-cms.json'),
    '/api/ui/counts': fixture('ui-counts.json'),
    '/api/ui/mheard/2': fixture('ui-mheard.json'),
    '/api/ui/events?limit=5': fixture('ui-events.json'),
    '/api/ui/events': fixture('ui-events.json'),
  });
  const st = await getStation();
  expect(st.ports.find((p) => p.number === 2)).toMatchObject({ txtailMs: 100, freqHz: 145630000 });
  expect(st.ports.find((p) => p.number === 1)?.freqHz).toBeNull();
  expect((await getLinkStates()).map((l) => l.state)).toEqual(['unknown', 'down', 'down']);
  expect((await getCms()).ok).toBeNull();
  expect((await getCounts()).full).toBe(false);
  expect(await getHeard(2)).toEqual([]);
  expect((await getEvents(5))[0]?.kind).toBe('restart');
  await getEvents();
  expect(calls.every((c) => (c.init as RequestInit | undefined)?.credentials === 'include')).toBe(true);
});
