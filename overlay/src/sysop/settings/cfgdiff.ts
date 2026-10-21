// Line diff between the loaded config and the draft, and its one-line summary.

export type DiffRow = { kind: 'del'; a: number; text: string } | { kind: 'add'; b: number; text: string };

/** Above this many cells the LCS table is skipped and the middle shows as removed then added. */
const DIFF_CELLS = 4_000_000;

/** Lines removed from `a` and added in `b`, in file order, with 1-based line numbers. */
export function lineDiff(a: string, b: string): DiffRow[] {
  const x = a.split('\n');
  const y = b.split('\n');
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  const A = x.slice(p, x.length - s);
  const B = y.slice(p, y.length - s);
  const out: DiffRow[] = [];
  const del = (i: number) => out.push({ kind: 'del', a: p + i + 1, text: A[i] as string });
  const add = (j: number) => out.push({ kind: 'add', b: p + j + 1, text: B[j] as string });
  const n = A.length;
  const m = B.length;
  if (n * m > DIFF_CELLS) {
    for (let i = 0; i < n; i++) del(i);
    for (let j = 0; j < m; j++) add(j);
    return out;
  }
  // dp[i][j]: longest common run of A[i..] and B[j..].
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = A[i] === B[j] ? (dp[(i + 1) * w + j + 1] as number) + 1
        : Math.max(dp[(i + 1) * w + j] as number, dp[i * w + j + 1] as number);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { i++; j++; } else if ((dp[(i + 1) * w + j] as number) >= (dp[i * w + j + 1] as number)) del(i++);
    else add(j++);
  }
  while (i < n) del(i++);
  while (j < m) add(j++);
  return out;
}

/**
 * "No changes", "1 line changed", "2 lines changed, 1 added": a removed line and an added line
 * pair up as one changed line; the rest are added or removed.
 */
export function changeSummary(diff: DiffRow[]): string {
  const adds = diff.filter((d) => d.kind === 'add').length;
  const dels = diff.length - adds;
  const changed = Math.min(adds, dels);
  const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;
  const rest = [adds > changed ? `${adds - changed} added` : '', dels > changed ? `${dels - changed} removed` : ''].filter(Boolean);
  if (!changed && !rest.length) return 'No changes';
  if (!changed) return `${lines(adds + dels)} ${adds ? 'added' : 'removed'}`;
  return [`${lines(changed)} changed`, ...rest].join(', ');
}
