import { useEffect, useState } from 'preact/hooks';

/** The time the given data last changed to a new successful reply. */
export function useUpdated(data: unknown): Date | undefined {
  const [at, setAt] = useState<Date | undefined>(undefined);
  useEffect(() => {
    if (data !== undefined) setAt(new Date());
  }, [data]);
  return at;
}
