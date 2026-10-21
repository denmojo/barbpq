import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import './confirm.css';

interface ConfirmDialogProps {
  title: string;
  /** The exact text that will be sent, shown as code. */
  command: string;
  children?: ComponentChildren;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before an action that changes node state. In-app, never window.confirm. Focus starts on
 * Cancel, so Enter alone does nothing harmful; Escape and a click outside cancel.
 */
export function ConfirmDialog({ title, command, children, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => before?.focus?.();
  }, []);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Tab') {
      // Two buttons: keep focus inside the dialog.
      e.preventDefault();
      (document.activeElement === cancel.current ? ok : cancel).current?.focus();
    }
  };
  return (
    <div class="cfm-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div class="cfm" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} onKeyDown={onKey}>
        <h2 id={`${id}-t`}>{title}</h2>
        <div id={`${id}-d`}>
          <p>Sends this command to the node console:</p>
          <code class="cmd">{command}</code>
          {children}
        </div>
        <div class="row">
          <button type="button" class="btn" ref={cancel} onClick={onCancel}>Cancel</button>
          <button type="button" class="btn danger" ref={ok} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
