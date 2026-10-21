import { themeMode, effectiveTheme, setThemeMode, loadThemeMode } from '../theme';

function mockScheme(dark: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: dark, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  themeMode.value = 'system';
});
afterEach(() => vi.restoreAllMocks());

test('system mode follows the OS', () => {
  mockScheme(true);
  expect(effectiveTheme()).toBe('dark');
});

test('opposite mode flips dark to light', () => {
  mockScheme(true);
  setThemeMode('opposite');
  expect(effectiveTheme()).toBe('light');
});

test('mode persists under bpqui.theme', () => {
  setThemeMode('opposite');
  expect(localStorage.getItem('bpqui.theme')).toBe('opposite');
  themeMode.value = 'system';
  expect(loadThemeMode()).toBe('opposite');
});

test('throwing localStorage leaves mode system', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(loadThemeMode()).toBe('system');
  expect(() => setThemeMode('system')).not.toThrow();
});
