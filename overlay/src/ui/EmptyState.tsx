import type { ComponentChildren } from 'preact';

export function EmptyState({ icon, title, hint }: { icon?: ComponentChildren; title: string; hint?: string }) {
  return (
    <div class="empty">
      {icon && <span class="big" aria-hidden="true">{icon}</span>}
      <span>{title}</span>
      {hint && <span class="hint">{hint}</span>}
    </div>
  );
}
