export interface TabItem { id: string; label: string }

/** Segmented tabs for switching a list in place (not routes). */
export function Tabs({ items, value, onChange, label }: {
  items: TabItem[]; value: string; onChange: (id: string) => void; label: string;
}) {
  return (
    <div class="tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button
          type="button"
          role="tab"
          aria-selected={t.id === value ? 'true' : 'false'}
          class={t.id === value ? 'tab on' : 'tab'}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
