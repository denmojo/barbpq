import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOTICE_PACKAGES, noticeBanner, thirdPartyNotices } from '../notices.mjs';
import { finishDist } from '../finish-dist.mjs';

const HOLDERS = ['Jason Miller', 'Preact Team', 'Lucide Icons and Contributors', 'Cole Bemis'];

test('notices hold each bundled package license, read from node_modules', () => {
  const text = thirdPartyNotices();
  expect(NOTICE_PACKAGES).toEqual(['preact', '@preact/signals', '@preact/signals-core', 'lucide-preact']);
  for (const p of NOTICE_PACKAGES) expect(text).toContain(p);
  for (const h of HOLDERS) expect(text).toContain(h);
  expect(text).toContain('ISC License');
  expect(text).toContain('Permission is hereby granted, free of charge');
});

test('the banner is one preserved comment that cannot end early', () => {
  const b = noticeBanner();
  expect(b.startsWith('/*!')).toBe(true);
  expect(b.trimEnd().endsWith('*/')).toBe(true);
  expect(b.indexOf('*/')).toBe(b.trimEnd().length - 2);
  expect(b).not.toContain('##');
});

function makeDist() {
  const d = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(d, 'ui'));
  writeFileSync(join(d, 'index.html'), '<html></html>');
  writeFileSync(join(d, 'ui/index-abc.js'), 'console.log(1)');
  writeFileSync(join(d, 'ui/chunk-def.js'), 'console.log(2)');
  writeFileSync(join(d, 'ui/style-abc.css'), 'a{}');
  return d;
}

test('finishDist puts the banner at the top of every ui/*.js, once', () => {
  const d = makeDist();
  finishDist(d);
  finishDist(d);
  for (const f of ['ui/index-abc.js', 'ui/chunk-def.js']) {
    const body = readFileSync(join(d, f), 'utf8');
    expect(body.startsWith(noticeBanner())).toBe(true);
    expect(body.split('/*!').length).toBe(2);
  }
  expect(readFileSync(join(d, 'ui/style-abc.css'), 'utf8')).toBe('a{}');
});
