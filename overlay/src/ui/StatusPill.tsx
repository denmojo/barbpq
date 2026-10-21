export type Tone = 'ok' | 'down' | 'warn' | 'idle';

/** A rounded status chip with a dot: Listening, Device open, Linked, Down, Unknown. */
export function StatusPill({ tone, label, title }: { tone: Tone; label: string; title?: string }) {
  return (
    <span class={`chip ${tone}`} title={title}>
      <span class="dot" aria-hidden="true" />
      {label}
    </span>
  );
}
