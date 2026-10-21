// vi.mock factories for the data modules. No imports here: vi.mock is hoisted above them.
export const MOCK_API = () => ({ getInfo: vi.fn(), getPorts: vi.fn(), getUsers: vi.fn(), getLinks: vi.fn(), getNodes: vi.fn() });
export const MOCK_UI = () => ({
  getStation: vi.fn(), getLinkStates: vi.fn(), getCms: vi.fn(), getCounts: vi.fn(), getHeard: vi.fn(), getEvents: vi.fn(),
});
export const MOCK_PAGES = () => ({ fetchRoutes: vi.fn(), fetchStats: vi.fn() });
