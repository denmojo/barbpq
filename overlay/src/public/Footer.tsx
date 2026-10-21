import { signal } from '@preact/signals';
import { formatClock } from '../ui/format';

/** Node version as last reported by /api/info, for footers on screens that do not read the station. */
export const nodeVersion = signal<string | undefined>(undefined);

export function Footer({ version, updated }: { version?: string; updated?: Date }) {
  const v = version ?? nodeVersion.value;
  return (
    <footer class="foot">
      {v && <span>LinBPQ {v}</span>}
      <span>G8BPQ, GPLv3</span>
      <span>BarBPQ - LinBPQ Web UI</span>
      {updated && <span>Updated {formatClock(updated)}</span>}
    </footer>
  );
}
