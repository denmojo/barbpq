// Unsaved mail edits and the record each screen has open, in memory only (never browser
// storage): a password typed into a draft must not outlive the page. They survive the screen
// unmounting while the sign-in screen is up after a session expires.
import { signal } from '@preact/signals';
import type { Draft } from './mailform';

const drafts = signal<Record<string, Draft>>({});
const picked = signal<Record<string, string>>({});

export const getDraft = (id: string): Draft | undefined => drafts.value[id];

export function setDraft(id: string, d: Draft): void {
  drafts.value = { ...drafts.value, [id]: d };
}

export function clearDraft(id: string): void {
  const { [id]: _gone, ...rest } = drafts.value;
  drafts.value = rest;
}

/** The record (partner, user, WP call) a screen has open. */
export const getPicked = (screen: string): string | undefined => picked.value[screen];

export function setPicked(screen: string, call: string): void {
  picked.value = { ...picked.value, [screen]: call };
}

/** An explicit sign-out forgets every draft and open record. */
export function resetMail(): void {
  drafts.value = {};
  picked.value = {};
}
