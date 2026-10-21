// Fills the mocked data modules with the sample data. Each test file mocks the
// modules with vi.mock first; this only sets what the mocks resolve to.
import * as api from '../../data/api';
import * as ui from '../../data/uiapi';
import * as pages from '../../data/pages';
import * as s from './sample';

export function prime(): void {
  vi.mocked(api.getInfo).mockResolvedValue(s.info);
  vi.mocked(api.getUsers).mockResolvedValue(s.users);
  vi.mocked(api.getLinks).mockResolvedValue(s.links);
  vi.mocked(api.getNodes).mockResolvedValue(s.nodes);
  vi.mocked(api.getPorts).mockResolvedValue([]);
  vi.mocked(ui.getStation).mockResolvedValue(s.station);
  vi.mocked(ui.getLinkStates).mockResolvedValue(s.linkStates);
  vi.mocked(ui.getCms).mockResolvedValue(s.cms);
  vi.mocked(ui.getCounts).mockResolvedValue(s.countsFull);
  vi.mocked(ui.getHeard).mockImplementation(async (port: number) => s.heardByPort[port] ?? []);
  vi.mocked(ui.getEvents).mockResolvedValue([]);
  vi.mocked(pages.fetchRoutes).mockResolvedValue(s.routes);
}

/** No element may link, frame or navigate to an old node, mail or webmail page. */
export function expectNoOldPageLinks(root: Element): void {
  const bad = /\/(node|mail|webmail)\b/i;
  for (const el of Array.from(root.querySelectorAll('[href],[src],[action],[formaction]'))) {
    for (const attr of ['href', 'src', 'action', 'formaction']) {
      const v = el.getAttribute(attr);
      if (v !== null) expect(v).not.toMatch(bad);
    }
  }
  expect(root.querySelectorAll('iframe, frame, object, embed')).toHaveLength(0);
}
