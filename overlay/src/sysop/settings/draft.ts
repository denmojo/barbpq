// The Settings screen's state: the config as loaded, the sysop's draft, and the save.
//
// It lives in module signals, not component state, so the draft survives the shell giving way
// to the sign-in screen when a session expires mid-edit. It lives in memory only: bpq32.cfg holds
// USER passwords and CMSPASS, so nothing here is written to browser storage or the console.
import { signal } from '@preact/signals';
import { extractConfigText, SaveFailedError, saveConfig } from '../../data/forms';
import { getProtected, withSysop } from '../../data/session';

export type SettingsTab = 'file' | 'ports' | 'apps' | 'users';

/** Config text as the node last gave it (or as last saved); null until loaded. */
export const cfgLoaded = signal<string | null>(null);
/** The text being edited; null until loaded. */
export const cfgDraft = signal<string | null>(null);
export const cfgLoad = signal<{ busy: boolean; error: Error | null }>({ busy: false, error: null });
export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'failed'; error: Error };
export const cfgSave = signal<SaveState>({ kind: 'idle' });
/** A save succeeded since the page loaded: the running node still has the old config. */
export const restartNeeded = signal(false);
export const settingsTab = signal<SettingsTab>('file');

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

let loading: Promise<void> | null = null;

/**
 * Read bpq32.cfg from the Edit Config page. A browser textarea reads CRLF as LF, and the node
 * drops CRs when it saves, so the text is kept with LF line ends.
 */
export function loadConfig(): Promise<void> {
  if (loading) return loading;
  cfgLoad.value = { busy: true, error: null };
  loading = withSysop(() => getProtected('/Node/EditCfg.html'))
    .then((html) => {
      const text = extractConfigText(html).replace(/\r\n/g, '\n');
      cfgLoaded.value = text;
      cfgDraft.value = text;
      cfgLoad.value = { busy: false, error: null };
    })
    .catch((e: unknown) => {
      cfgLoad.value = { busy: false, error: asError(e) };
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Save the draft. On an expired session saveConfig waits for the sign-in and retries; the draft stays put. */
export async function saveDraft(): Promise<void> {
  const text = cfgDraft.peek();
  if (text === null || cfgSave.peek().kind === 'saving') return;
  cfgSave.value = { kind: 'saving' };
  try {
    await saveConfig(text);
    cfgLoaded.value = text;
    restartNeeded.value = true;
    cfgSave.value = { kind: 'idle' };
  } catch (e) {
    const err = asError(e);
    cfgSave.value = { kind: 'failed', error: err instanceof SaveFailedError ? err : new Error(`Config save failed: ${err.message}`) };
  }
}

export function editDraft(text: string): void {
  cfgDraft.value = text;
  if (cfgSave.peek().kind === 'failed') cfgSave.value = { kind: 'idle' };
}

export function discardDraft(): void {
  cfgDraft.value = cfgLoaded.peek();
  cfgSave.value = { kind: 'idle' };
}

/** Forget the config: on an explicit sign-out, and between tests. */
export function resetSettings(): void {
  cfgLoaded.value = null;
  cfgDraft.value = null;
  cfgLoad.value = { busy: false, error: null };
  cfgSave.value = { kind: 'idle' };
  restartNeeded.value = false;
  settingsTab.value = 'file';
  loading = null;
}
