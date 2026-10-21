import { signal } from '@preact/signals';

export type ThemeMode = 'system' | 'opposite';
export const STORAGE_KEY = 'bpqui.theme';

// 'system' follows prefers-color-scheme; 'opposite' shows the other one.
export const themeMode = signal<ThemeMode>('system');

function systemQuery(): MediaQueryList | null {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    return null;
  }
}

export const systemDark = signal<boolean>(systemQuery()?.matches ?? false);

export function loadThemeMode(): ThemeMode {
  let mode: ThemeMode = 'system';
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'opposite') mode = 'opposite';
  } catch {
    /* storage blocked: stay on system */
  }
  themeMode.value = mode;
  return mode;
}

export function setThemeMode(mode: ThemeMode): void {
  themeMode.value = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* not persisted */
  }
}

export function toggleTheme(): void {
  setThemeMode(themeMode.value === 'system' ? 'opposite' : 'system');
}

export function effectiveTheme(): 'light' | 'dark' {
  const dark = systemQuery()?.matches ?? systemDark.value;
  const sys = dark ? 'dark' : 'light';
  if (themeMode.value === 'system') return sys;
  return sys === 'dark' ? 'light' : 'dark';
}

// applyTheme writes data-theme on <html>; call it from an effect so it
// tracks both the mode and the system preference.
export function applyTheme(): void {
  void systemDark.value;
  document.documentElement.dataset.theme = effectiveTheme();
}

export function watchSystemTheme(): void {
  const mq = systemQuery();
  if (!mq) return;
  mq.addEventListener('change', (e) => {
    systemDark.value = e.matches;
  });
}
