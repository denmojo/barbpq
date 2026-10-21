import { render, act } from '@testing-library/preact';
import { usePoll } from '../poll';

afterEach(() => vi.useRealTimers());

function Probe({ fn }: { fn: () => Promise<number> }) {
  const { data, stale, error } = usePoll(fn, 1000);
  return <p>{`d=${data ?? '-'} stale=${stale} err=${error?.message ?? '-'}`}</p>;
}

test('stale turns true after two failed polls and clears on success; data is kept', async () => {
  vi.useFakeTimers();
  let mode: 'ok' | 'fail' = 'ok';
  const fn = vi.fn(async () => {
    if (mode === 'fail') throw new Error('down');
    return 7;
  });
  const { container } = render(<Probe fn={fn} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(container.textContent).toBe('d=7 stale=false err=-');
  mode = 'fail';
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.textContent).toBe('d=7 stale=false err=down');
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.textContent).toBe('d=7 stale=true err=down');
  mode = 'ok';
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.textContent).toBe('d=7 stale=false err=-');
});

test('no request while the page is hidden; polling resumes when it is shown', async () => {
  vi.useFakeTimers();
  let isHidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
  const fn = vi.fn(async () => 1);
  render(<Probe fn={fn} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fn).toHaveBeenCalledTimes(1);
  isHidden = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(fn).toHaveBeenCalledTimes(1);
  isHidden = false;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
  expect(fn).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(fn).toHaveBeenCalledTimes(3);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

function Gated({ fn, enabled, k }: { fn: () => Promise<number>; enabled: boolean; k?: string }) {
  const { data } = usePoll(fn, 1000, { enabled, key: k });
  return <p>{`d=${data ?? '-'}`}</p>;
}

test('a disabled poll makes no request until enabled; a new key restarts it', async () => {
  vi.useFakeTimers();
  const fn = vi.fn(async () => 5);
  const { rerender, container } = render(<Gated fn={fn} enabled={false} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(fn).not.toHaveBeenCalled();
  rerender(<Gated fn={fn} enabled k="a" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fn).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe('d=5');
  rerender(<Gated fn={fn} enabled k="b" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fn).toHaveBeenCalledTimes(2);
});
