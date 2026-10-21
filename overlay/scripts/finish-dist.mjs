// Post-build step: make dist/ safe for linbpq's file server (HTTPcode.c).
//  - only .js and .css under ui/ (other types go out as text/html)
//  - no path containing "htm" may hold "##" (template substitution)
//  - index.html is copied to indexnoaprs.html; no NodeMenu.html
//  - every ui/*.js starts with the third-party license banner (notices.mjs)
import { copyFileSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noticeBanner } from './notices.mjs';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function finishDist(dist) {
  rmSync(join(dist, 'NodeMenu.html'), { force: true });
  const files = walk(dist).map((p) => relative(dist, p).split(sep).join('/'));
  const problems = [];
  for (const f of files) {
    if (f === 'index.html' || f === 'indexnoaprs.html') continue;
    if (!/^ui\/[^/]+\.(js|css)$/.test(f)) {
      problems.push(`${f}: only ui/*.js and ui/*.css may ship (other types are served as text/html)`);
    }
  }
  for (const f of files) {
    if (/htm/i.test(f) && readFileSync(join(dist, f), 'utf8').includes('##')) {
      problems.push(`${f}: path contains "htm" and body contains "##" (template substitution)`);
    }
  }
  if (!files.includes('index.html')) problems.push('index.html is missing');
  if (problems.length) throw new Error('dist is not servable by linbpq:\n' + problems.join('\n'));

  copyFileSync(join(dist, 'index.html'), join(dist, 'indexnoaprs.html'));

  const banner = noticeBanner();
  for (const f of files.filter((f) => /^ui\/[^/]+\.js$/.test(f))) {
    const p = join(dist, f);
    const body = readFileSync(p, 'utf8');
    if (!body.startsWith(banner)) writeFileSync(p, banner + body);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    finishDist(fileURLToPath(new URL('../dist', import.meta.url)));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
