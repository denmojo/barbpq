// License notices for dist/ui/*.js: the overlay's own copyright line, then the bundled code's.
// The texts are read from each package's own LICENSE file in node_modules.
// lucide-preact's LICENSE also carries the Feather MIT notice.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOTICE_PACKAGES = ['preact', '@preact/signals', '@preact/signals-core', 'lucide-preact'];

// A string, not new URL(): under vitest's jsdom environment URL is jsdom's class.
const NODE_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');

export function thirdPartyNotices(nodeModules = NODE_MODULES) {
  return NOTICE_PACKAGES.map((p) => {
    const text = readFileSync(join(nodeModules, p, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim();
    return `${p}\n\n${text}`;
  }).join('\n\n----------------------------------------------------------------------\n\n');
}

/** The overlay's own copyright line, ahead of the third-party texts. */
export const OWN_NOTICE = 'BarBPQ - LinBPQ Web UI. Copyright (C) 2026 Dennis Mojado. '
  + 'GNU General Public License, version 3 or (at your option) any later version; see LICENSE in the source.';

/** One preserved block comment; "*" + "/" inside a notice is broken up so it cannot close it early. */
export function noticeBanner(nodeModules = NODE_MODULES) {
  const body = thirdPartyNotices(nodeModules).replace(/\*\//g, '* /').replace(/##/g, '# #');
  return `/*! ${OWN_NOTICE}\n\nThird-party code bundled in this file, under its own license:\n\n${body}\n*/\n`;
}
