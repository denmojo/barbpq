import type { ComponentChildren } from 'preact';

export interface Column { label: string; align?: 'left' | 'right'; mono?: boolean }

/** A plain table in a wrapper that scrolls sideways on a narrow screen, so the page never does. */
export function Table({ columns, children, label }: { columns: Column[]; children: ComponentChildren; label: string }) {
  return (
    <div class="table-wrap">
      <table class="tbl" aria-label={label}>
        <thead>
          <tr>{columns.map((c) => <th class={c.align === 'right' ? 'r' : undefined} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
