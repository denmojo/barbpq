// Section folding for the bpq32.cfg editor. Folding is view state only: the file text is never
// changed by it. The text is cut into pieces at line boundaries, folded regions are shown as one
// row, and an edit to any other piece is put back between the untouched lines around it.
import type { CfgLine } from './cfgcheck';

export type FoldKind = 'port' | 'tncport' | 'text';

export interface FoldRegion {
  /**
   * "port:2" for the PORT block with PORTNUM=2, so a fold stays on its block when blocks are added
   * or removed above it; kind and ordinal ("port#0", "text#1") for a block with no PORTNUM.
   */
  key: string;
  kind: FoldKind;
  /** 1-based first and last line, both inside the region (PORT ... ENDPORT, IDMSG: ... ***). */
  start: number;
  end: number;
  label: string;
}

const valueOf = (l: CfgLine): string => {
  const code = l.commentAt >= 0 ? l.text.slice(0, l.commentAt) : l.text;
  const eq = code.indexOf('=');
  return eq >= 0 ? code.slice(eq + 1).trim() : '';
};

function portLabel(body: CfgLine[], start: number): string {
  const num = body.find((l) => l.kind === 'keyword' && l.key === 'PORTNUM');
  const id = body.find((l) => l.kind === 'keyword' && l.key === 'ID');
  const parts = [num && valueOf(num) ? `PORT ${valueOf(num)}` : `PORT (line ${start})`];
  if (id && valueOf(id)) parts.push(valueOf(id));
  return parts.join(' · ');
}

/**
 * The blocks the config scan already finds: PORT ... ENDPORT (by its block index), TNCPORT ...
 * ENDPORT (its tnc section), and the multi-line texts (IDMSG:, CTEXT:, ... up to ***). A block
 * of one line has nothing to fold.
 */
export function foldRegions(lines: CfgLine[]): FoldRegion[] {
  const out: FoldRegion[] = [];
  const count: Record<FoldKind, number> = { port: 0, tncport: 0, text: 0 };
  const add = (kind: FoldKind, start: number, end: number, label: string, num?: string): void => {
    if (end <= start) return;
    const ord = count[kind]++;
    let key = num ? `${kind}:${num}` : `${kind}#${ord}`;
    if (out.some((r) => r.key === key)) key = `${kind}#${ord}`;   // two blocks with one PORTNUM
    out.push({ key, kind, start, end, label });
  };
  let i = 0;
  while (i < lines.length) {
    const l = lines[i] as CfgLine;
    if (l.block !== null && l.kind === 'port') {
      let j = i;
      while (j + 1 < lines.length && (lines[j + 1] as CfgLine).block === l.block) j++;
      const body = lines.slice(i, j + 1);
      const num = body.find((x) => x.kind === 'keyword' && x.key === 'PORTNUM');
      add('port', l.n, (lines[j] as CfgLine).n, portLabel(body, l.n), num ? valueOf(num) || undefined : undefined);
      i = j + 1;
      continue;
    }
    if (l.kind === 'port' && l.section === 'tnc') {
      let j = i;
      while (j + 1 < lines.length && (lines[j + 1] as CfgLine).section === 'tnc') j++;
      add('tncport', l.n, (lines[j] as CfgLine).n, l.text.trim());
      i = j + 1;
      continue;
    }
    const next = lines[i + 1];
    if (l.kind === 'keyword' && next && (next.kind === 'text' || next.kind === 'textend')) {
      let j = i + 1;
      while (j < lines.length && (lines[j] as CfgLine).kind === 'text') j++;
      if (j >= lines.length || (lines[j] as CfgLine).kind !== 'textend') j--;
      add('text', l.n, (lines[j] as CfgLine).n, l.text.slice(l.keyStart, l.keyEnd));
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** A run of lines shown for editing (0-based raw line indexes, `to` exclusive), or a folded region. */
export type Piece = { type: 'edit'; from: number; to: number } | { type: 'fold'; region: FoldRegion };

/** The pieces for `count` lines with the given regions folded, in file order. */
export function pieces(count: number, regions: FoldRegion[], folded: ReadonlySet<string>): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const r of regions) {
    if (!folded.has(r.key)) continue;
    if (r.start - 1 > at) out.push({ type: 'edit', from: at, to: r.start - 1 });
    out.push({ type: 'fold', region: r });
    at = r.end;
  }
  if (at < count) out.push({ type: 'edit', from: at, to: count });
  return out;
}

/** The text of an edit piece: its raw lines (CR kept) joined as the file joins them. */
export function pieceText(raw: string[], p: { from: number; to: number }): string {
  return raw.slice(p.from, p.to).join('\n');
}

/** The whole file after the piece's text became `text`; every line outside it is kept byte for byte. */
export function replacePiece(raw: string[], p: { from: number; to: number }, text: string): string {
  return [...raw.slice(0, p.from), text, ...raw.slice(p.to)].join('\n');
}
