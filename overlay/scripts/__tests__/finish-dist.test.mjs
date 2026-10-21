import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finishDist } from '../finish-dist.mjs';

function makeDist(extra = {}) {
  const d = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(d, 'ui'));
  writeFileSync(join(d, 'index.html'), '<html><title>x</title></html>');
  writeFileSync(join(d, 'ui/app-abc.js'), 'console.log(1)');
  writeFileSync(join(d, 'ui/app-abc.css'), 'a{}');
  for (const [p, body] of Object.entries(extra)) writeFileSync(join(d, p), body);
  return d;
}

test('rejects a logo.svg', () => {
  expect(() => finishDist(makeDist({ 'ui/logo.svg': '<svg/>' }))).toThrow(/logo\.svg/);
});

test('rejects ## in html', () => {
  const d = makeDist();
  writeFileSync(join(d, 'index.html'), '<p>##x##</p>');
  expect(() => finishDist(d)).toThrow(/##/);
});

test('copies index to indexnoaprs and leaves no NodeMenu.html', () => {
  const d = makeDist({ 'NodeMenu.html': 'old' });
  finishDist(d);
  expect(readFileSync(join(d, 'indexnoaprs.html'), 'utf8')).toBe(readFileSync(join(d, 'index.html'), 'utf8'));
  expect(existsSync(join(d, 'NodeMenu.html'))).toBe(false);
});
