import { Fragment } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { navigate } from '../app/router';
import { filterPalette, paletteItems, type PaletteItem } from './palette';
import { IconSearch } from './icons';

export function runItem(item: PaletteItem): void {
  if (item.route) navigate(item.route);
  item.action?.();
}

/** ⌘K / Ctrl+K anywhere opens it; Escape closes; arrows move; Enter runs the highlighted item. */
export function usePaletteHotkey(open: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const items = filterPalette(paletteItems(), query);
  const current = Math.min(active, Math.max(items.length - 1, 0));

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current, query]);

  const choose = (item: PaletteItem | undefined): void => {
    if (!item) return;
    onClose();
    runItem(item);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(items.length ? (current + 1) % items.length : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(items.length ? (current - 1 + items.length) % items.length : 0);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(items.length - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[current]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // The palette holds focus while open; the input is its only stop.
      e.preventDefault();
    }
  };

  let lastGroup: string | undefined;
  return (
    <div class="pal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="pal" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="pal-search">
          <IconSearch />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={items.length ? `${id}-${current}` : undefined}
            aria-autocomplete="list"
            aria-label="Jump to a screen or command"
            placeholder="Jump to a screen or command"
            autocomplete="off"
            spellcheck={false}
            value={query}
            onInput={(e) => { setQuery((e.target as HTMLInputElement).value); setActive(0); }}
            onKeyDown={onKey}
          />
          <kbd>Esc</kbd>
        </div>
        <ul class="pal-list" id={`${id}-list`} role="listbox" aria-label="Results" ref={list}>
          {items.map((item, i) => {
            const head = item.group && item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <Fragment key={`${item.group ?? ''}:${item.label}`}>
                {head && <li class="pal-group" role="presentation">{head}</li>}
                <li
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === current ? 'true' : 'false'}
                  class={i === current ? 'pal-item on' : 'pal-item'}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  {item.label}
                </li>
              </Fragment>
            );
          })}
          {!items.length && <li class="pal-none" role="presentation">Nothing matches “{query}”.</li>}
        </ul>
        <div class="pal-foot" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> open <kbd>esc</kbd> close</div>
      </div>
    </div>
  );
}
