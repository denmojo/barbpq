// The raw bpq32.cfg editor: a textarea over a highlighted copy of the same text, a gutter with
// line numbers and check marks, the check results, and a line diff against the loaded text.
// It shows the full file, USER lines included, as the node's own Edit Config page does.
import type { ComponentChildren } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import { Card } from '../../ui/Card';
import { scanCfg, type CfgLine, type Issue } from './cfgcheck';

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

const KEY_CLASS: Partial<Record<CfgLine['kind'], string>> = {
  keyword: 'tk-key', unknown: 'tk-unk', port: 'tk-port', endport: 'tk-endport', driver: 'tk-drv',
};

function renderLine(l: CfgLine): ComponentChildren {
  const t = l.text;
  if (l.kind === 'blank') return t;
  if (l.kind === 'comment') return <span class="tk-comment">{t}</span>;
  const end = l.commentAt >= 0 ? l.commentAt : t.length;
  const comment = l.commentAt >= 0 ? <span class="tk-comment">{t.slice(l.commentAt)}</span> : null;
  if (l.kind === 'text') return <><span class="tk-text">{t.slice(0, end)}</span>{comment}</>;
  if (l.kind === 'textend') return <><span class="tk-mark">{t.slice(0, end)}</span>{comment}</>;
  return (
    <>
      {t.slice(0, l.keyStart)}
      <span class={KEY_CLASS[l.kind]}>{t.slice(l.keyStart, l.keyEnd)}</span>
      {t.slice(l.keyEnd, end)}
      {comment}
    </>
  );
}

/** Offset of the start of 1-based line n. */
function lineOffset(text: string, n: number): number {
  let off = 0;
  for (let k = 1; k < n; k++) {
    const nl = text.indexOf('\n', off);
    if (nl < 0) return text.length;
    off = nl + 1;
  }
  return off;
}

export const LINE_PX = 20;

const MAX_DIFF_ROWS = 300;

export function ConfigEditor({ value, original, issues, onInput }: {
  value: string; original: string; issues: Issue[]; onInput: (text: string) => void;
}) {
  const lines = useMemo(() => scanCfg(value), [value]);
  const diff = useMemo(() => lineDiff(original, value), [original, value]);
  const changed = useMemo(() => new Set(diff.flatMap((d) => (d.kind === 'add' ? [d.b] : []))), [diff]);
  const marks = useMemo(() => {
    const m = new Map<number, Issue['severity']>();
    for (const i of issues) if (m.get(i.line) !== 'error') m.set(i.line, i.severity);
    return m;
  }, [issues]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const hl = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);

  const sync = (): void => {
    const el = ta.current;
    if (!el) return;
    if (hl.current) hl.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    if (gutter.current) gutter.current.style.transform = `translateY(${-el.scrollTop}px)`;
  };
  const jump = (n: number): void => {
    const el = ta.current;
    if (!el) return;
    const off = lineOffset(el.value, n);
    el.focus();
    el.setSelectionRange(off, off);
    el.scrollTop = Math.max(0, (n - 1) * LINE_PX - el.clientHeight / 3);
    sync();
  };
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  return (
    <>
      <Card title="bpq32.cfg" span={12} class="cfg-card">
        <div class="cfged">
          <div class="cfg-gutter" aria-hidden="true">
            <div ref={gutter}>
              {lines.map((l) => {
                const mark = marks.get(l.n);
                return <div key={l.n} class={['gn', changed.has(l.n) ? 'chg' : '', mark ?? ''].join(' ').trim()}>{l.n}</div>;
              })}
            </div>
          </div>
          <div class="cfg-area">
            <pre class="cfg-hl" aria-hidden="true" ref={hl}>
              {lines.map((l) => (
                <div key={l.n} class={['ln', changed.has(l.n) ? 'chg' : '', l.block !== null ? 'blk' : ''].join(' ').trim()}>{renderLine(l)}</div>
              ))}
            </pre>
            <textarea ref={ta} aria-label="bpq32.cfg" wrap="off" spellcheck={false} autocapitalize="off" autocomplete="off"
              value={value} onInput={(e) => { onInput((e.currentTarget as HTMLTextAreaElement).value); }} onScroll={sync} />
          </div>
        </div>
        <div class="cfg-check">
          <div class="cfg-check-h">
            Check: {errors === 0 && warnings === 0 ? 'no problems found'
              : [errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : '', warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : '']
                .filter(Boolean).join(', ')}
          </div>
          {issues.length > 0 && (
            <ul class="cfg-issues" aria-label="Config check">
              {issues.map((i) => (
                <li key={`${i.line}:${i.message}`} class={i.severity}>
                  <span class="dot" aria-hidden="true" />
                  <button type="button" class="linkbtn" onClick={() => jump(i.line)}>Line {i.line}</button>
                  <span class="sev">{i.severity === 'error' ? 'Error' : 'Warning'}</span>
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Card title="Changes" span={12}>
        {diff.length === 0 ? <p class="muted cfg-nochg">No changes since the file was loaded.</p> : (
          <ul class="cfg-diff" aria-label="Changed lines">
            {diff.slice(0, MAX_DIFF_ROWS).map((d) => (
              <li key={d.kind === 'add' ? `b${d.b}` : `a${d.a}`} class={d.kind}>
                <span class="dn">{d.kind === 'add' ? d.b : d.a}</span>
                <span class="sign" aria-label={d.kind === 'add' ? 'added' : 'removed'}>{d.kind === 'add' ? '+' : '−'}</span>
                <code>{d.text}</code>
              </li>
            ))}
            {diff.length > MAX_DIFF_ROWS && <li class="more muted">and {diff.length - MAX_DIFF_ROWS} more</li>}
          </ul>
        )}
      </Card>
    </>
  );
}
