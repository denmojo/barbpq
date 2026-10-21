// Command palette registry. The shell registers its screens and commands; later screens
// add their own (settings, console commands) with registerPaletteItems.
import { signal } from '@preact/signals';
import type { Route } from '../app/router';

export interface PaletteItem {
  label: string;
  /** Screen to open. */
  route?: Route;
  /** Command to run instead of (or after) navigating. */
  action?: () => void;
  /** Extra words that match a search, e.g. "theme dark light". */
  keywords?: string;
  /** Group heading in the list, e.g. "Go to", "Command". */
  group?: string;
}

const registry = signal<PaletteItem[]>([]);

/** Every registered item, in registration order. */
export function paletteItems(): PaletteItem[] {
  return registry.value;
}

/** Add items; returns a function that removes them again. */
export function registerPaletteItems(items: PaletteItem[]): () => void {
  registry.value = [...registry.value, ...items];
  return () => {
    registry.value = registry.value.filter((i) => !items.includes(i));
  };
}

/** Items whose label, group or keywords contain every word of the query, case-insensitive. */
export function filterPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((i) => {
    const hay = `${i.label} ${i.group ?? ''} ${i.keywords ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
