// The list of records on a record page (forwarding partners, BBS users, WP calls).
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Skel } from '../../ui/Skel';

export function RecordPicker({ label, calls, picked, onPick, empty }: {
  label: string; calls: string[] | undefined; picked: string | null; onPick: (call: string) => void; empty?: ComponentChildren;
}) {
  if (!calls) return <p><Skel /></p>;
  if (!calls.length) return <p class="muted">{empty ?? 'None.'}</p>;
  return (
    <ul class="mf-picker" aria-label={label}>
      {calls.map((c) => (
        <li key={c}>
          <button type="button" class="mf-pick mono" aria-pressed={c === picked ? 'true' : 'false'} onClick={() => onPick(c)}>{c}</button>
        </li>
      ))}
    </ul>
  );
}

/** A button that asks once more before it acts. */
export function ConfirmButton({ label, confirm, busy, onConfirm }: {
  label: string; confirm: string; busy?: boolean; onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" class="btn" disabled={busy} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span class="mf-confirm" role="group" aria-label={label}>
      <span>{confirm}</span>
      <button type="button" class="btn danger" onClick={() => { setAsking(false); onConfirm(); }}>Yes, {label.toLowerCase()}</button>
      <button type="button" class="btn" onClick={() => setAsking(false)}>Keep</button>
    </span>
  );
}
