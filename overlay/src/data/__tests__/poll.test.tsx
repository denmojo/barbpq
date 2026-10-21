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
