import { useEffect, useRef, useState } from 'preact/hooks';

export interface Poll<T> { data: T | undefined; error: Error | undefined; stale: boolean }

export interface PollOptions {
  /** false holds the poll until it turns true (e.g. waiting on another poll's data). Default true. */
  enabled?: boolean;
  /** A change restarts the poll at once, e.g. when the inputs the poll reads change. */
  key?: string | number;
}

/** Failed polls in a row before the screens show an offline banner. */
export const STALE_AFTER = 2;

const hidden = (): boolean => typeof document !== 'undefined' && document.hidden === true;

/**
 * Call fn now and every everyMs. Keeps the last good data; `stale` after two failures in a row.
 * While the page is hidden no request is made; polling resumes at once when it is shown again.
 */
export function usePoll<T>(fn: () => Promise<T>, everyMs: number, opts: PollOptions = {}): Poll<T> {
  const [state, setState] = useState<Poll<T>>({ data: undefined, error: undefined, stale: false });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let failures = 0;
    let paused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      timer = undefined;
      if (hidden()) {
        paused = true;
        return;
      }
      try {
        const data = await fnRef.current();
        failures = 0;
        if (alive) setState({ data, error: undefined, stale: false });
      } catch (e) {
        failures += 1;
        const error = e instanceof Error ? e : new Error(String(e));
        if (alive) setState((s) => ({ data: s.data, error, stale: failures >= STALE_AFTER }));
      }
      if (alive) timer = setTimeout(tick, everyMs);
    };
    const onVisibility = (): void => {
      if (alive && paused && !hidden()) {
        paused = false;
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    void tick();
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer) clearTimeout(timer);
    };
  }, [everyMs, enabled, opts.key]);

  return state;
}
