/**
 * Shown after a config save. linbpq reads bpq32.cfg only when it starts, so the running node
 * still has the old settings. This only tells the sysop; it never asks the node to restart.
 */
export function RestartBanner() {
  return (
    <div class="restart-banner" role="status" aria-label="Restart needed">
      <span class="errdot" aria-hidden="true" />
      <span>Saved. Restart linbpq to apply.</span>
    </div>
  );
}
