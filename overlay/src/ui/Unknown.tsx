/** A value the node did not report. The reason shows as a tooltip. */
export function Unknown({ reason }: { reason: string }) {
  return <span class="unknown" title={reason}>Unknown</span>;
}
