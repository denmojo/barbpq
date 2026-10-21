// Unsaved mail edits and the record each screen has open, in memory only (never browser
// storage): a password typed into a draft must not outlive the page. They survive the screen
// unmounting while the sign-in screen is up after a session expires.
import { signal } from '@preact/signals';
import type { Draft } from './mailform';

/** A draft and the page values it started from, so a reload can tell the edits apart. */
export interface DraftEntry { draft: Draft; base: Record<string, string> }

const drafts = signal<Record<string, DraftEntry>>({});
const picked = signal<Record<string, string>>({});

export type MailTab = 'conf' | 'wel' | 'wp';
/** The Mail settings tab; the palette sets it. */
export const mailTab = signal<MailTab>('conf');

export const getDraft = (id: string): DraftEntry | undefined => drafts.value[id];

export function setDraft(id: string, draft: Draft, base: Record<string, string>): void {
  drafts.value = { ...drafts.value, [id]: { draft, base } };
}

export function clearDraft(id: string): void {
  const { [id]: _gone, ...rest } = drafts.value;
  drafts.value = rest;
}

/** The record (partner, user, WP call) a screen last opened. Screens use it only while their list holds it. */
export const getPicked = (screen: string): string | undefined => picked.value[screen];

export function setPicked(screen: string, call: string): void {
  picked.value = { ...picked.value, [screen]: call };
}

/** The pick if the list holds it, else the list's first entry; null while the list is loading. */
export function pickFrom(screen: string, list: string[] | undefined): string | null {
  if (!list) return null;
  const p = picked.value[screen];
  return p && list.includes(p) ? p : list[0] ?? null;
}

/** An explicit sign-out forgets every draft and open record. */
export function resetMail(): void {
  drafts.value = {};
  picked.value = {};
  mailTab.value = 'conf';
}
