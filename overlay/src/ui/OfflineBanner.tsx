import { formatClock } from './format';

/** Shown when polls have failed twice in a row; the screen keeps the last data it had. */
export function OfflineBanner({ show, since }: { show: boolean; since?: Date }) {
  if (!show) return null;
  return (
    <div class="offline" role="alert">
      <span class="errdot" aria-hidden="true" />
      <span>
        Can't reach the node.{' '}
        {since ? `Showing what it last reported at ${formatClock(since)}.` : 'Retrying.'}
      </span>
    </div>
  );
}
