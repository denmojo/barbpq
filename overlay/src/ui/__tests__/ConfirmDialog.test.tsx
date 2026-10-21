import { render, screen, fireEvent } from '@testing-library/preact';
import { ConfirmDialog } from '../ConfirmDialog';

function setup() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const outer = vi.fn();
  render(
    <div onKeyDown={outer}>
      <ConfirmDialog title="Send PORTS?" command="PORTS" confirmLabel="Send PORTS" onConfirm={onConfirm} onCancel={onCancel}>
        <p>Lists the node ports.</p>
      </ConfirmDialog>
    </div>,
  );
  return { onConfirm, onCancel, outer };
}

test('shows the exact command, starts on Cancel, and sends only on Confirm', () => {
  const confirmSpy = vi.spyOn(window, 'confirm');
  const { onConfirm, onCancel } = setup();
  const dlg = screen.getByRole('alertdialog', { name: 'Send PORTS?' });
  expect(dlg.querySelector('code')).toHaveTextContent(/^PORTS$/);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send PORTS' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(confirmSpy).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

test('Escape cancels and does not reach handlers outside the dialog', () => {
  const { onCancel, outer, onConfirm } = setup();
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});
