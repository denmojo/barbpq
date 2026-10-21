// The raw bpq32.cfg editor: a textarea over a highlighted copy of the same text, a gutter with
// line numbers and check marks, the check results, and a line diff against the loaded text.
// It shows the full file, USER lines included, as the node's own Edit Config page does.
import type { ComponentChildren } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import { Card } from '../../ui/Card';
import type { CfgLine, Issue } from './cfgcheck';
import type { DiffRow } from './cfgdiff';

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

/** `lines`, `issues` and `diff` come from the screen, which computes them once per edit. */
export function ConfigEditor({ value, lines, issues, diff, onInput }: {
  value: string; lines: CfgLine[]; issues: Issue[]; diff: DiffRow[]; onInput: (text: string) => void;
}) {
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
