import { useEffect, useRef, useState } from 'preact/hooks';

export interface Poll<T> { data: T | undefined; error: Error | undefined; stale: boolean }

/** Failed polls in a row before the screens show an offline banner. */
export const STALE_AFTER = 2;

/** Call fn now and every everyMs. Keeps the last good data; `stale` after two failures in a row. */
export function usePoll<T>(fn: () => Promise<T>, everyMs: number): Poll<T> {
  const [state, setState] = useState<Poll<T>>({ data: undefined, error: undefined, stale: false });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
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
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [everyMs]);

  return state;
}
