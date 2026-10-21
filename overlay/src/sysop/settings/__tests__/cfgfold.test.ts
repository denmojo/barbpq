import { scanCfg } from '../cfgcheck';
import { foldRegions, pieces, pieceText, replacePiece } from '../cfgfold';
import { SAMPLE_CFG } from './sample';

test('foldRegions finds the PORT blocks, the IDMSG: text and a TNCPORT block, from the scan', () => {
  const cfg = `${SAMPLE_CFG}TNCPORT\r\n COM=/dev/ttyS0\r\n TYPE=TNC2\r\nENDPORT\r\n`;
  const regions = foldRegions(scanCfg(cfg));
  expect(regions.map((r) => [r.key, r.start, r.end, r.label])).toEqual([
    ['text#0', 9, 11, 'IDMSG:'],
    ['port:1', 18, 29, 'PORT 1 · Telnet Server'],
    ['port:3', 31, 37, 'PORT 3 · VARA FM'],
    ['port:2', 39, 48, 'PORT 2 · Direwolf'],
    ['tncport#0', 52, 55, 'TNCPORT'],
  ]);
  const lines = cfg.split('\n');
  expect(lines[17]).toBe('PORT');
  expect(lines[28]).toBe('ENDPORT');
});

test('a PORT inside a /* */ comment is not a block, and a one-line block has nothing to fold', () => {
  expect(foldRegions(scanCfg('/* x\nPORT\n*/\nNODECALL=A\n')).length).toBe(0);
  expect(foldRegions(scanCfg('NODECALL=A\nPORT'))).toEqual([]);
});

test('pieces: the text around the folded regions, in order, covering every line once', () => {
  const lines = scanCfg(SAMPLE_CFG);
  const regions = foldRegions(lines);
  const ps = pieces(lines.length, regions, new Set(['port:1', 'port:2']));
  expect(ps.map((p) => (p.type === 'edit' ? [p.from, p.to] : p.region.key))).toEqual([[0, 17], 'port:1', [29, 38], 'port:2', [48, 52]]);
  expect(pieces(lines.length, regions, new Set())).toEqual([{ type: 'edit', from: 0, to: lines.length }]);
});

test('an edit to one piece leaves every other byte as it was, CRLF, tabs and Latin-1 included', () => {
  const cfg = SAMPLE_CFG.replace(/\n/g, '\r\n').replace('IDINTERVAL=15', 'IDINTERVAL=15\t; 20° east');
  const raw = cfg.split('\n');
  const lines = scanCfg(cfg);
  const ps = pieces(lines.length, foldRegions(lines), new Set(['port:1', 'port:3', 'port:2', 'text#0']));
  const edits = ps.filter((p) => p.type === 'edit');
  // Unchanged pieces put back give the same file.
  for (const p of edits) expect(replacePiece(raw, p, pieceText(raw, p))).toBe(cfg);
  const first = edits[0]!;
  const after = replacePiece(raw, first, pieceText(raw, first).replace('LOCATOR=CM98hj', 'LOCATOR=CM98hk'));
  expect(after).toBe(cfg.replace('LOCATOR=CM98hj', 'LOCATOR=CM98hk'));
});

test('a folded PORT keeps its fold when a PORT block is added above it (keyed by PORTNUM)', () => {
  const before = foldRegions(scanCfg(SAMPLE_CFG)).find((r) => r.label.startsWith('PORT 2'))!;
  const added = SAMPLE_CFG.replace('PORT\n PORTNUM=1', 'PORT\n PORTNUM=9\n ID=New\nENDPORT\n\nPORT\n PORTNUM=1');
  const after = foldRegions(scanCfg(added)).find((r) => r.key === before.key)!;
  expect(after.label).toBe('PORT 2 · Direwolf');
  expect(after.start).toBe(before.start + 5);
  const dup = foldRegions(scanCfg('NODECALL=A\nPORT\n PORTNUM=1\nENDPORT\nPORT\n PORTNUM=1\nENDPORT\n')).map((r) => r.key);
  expect(dup).toEqual(['port:1', 'port#1']);
});
