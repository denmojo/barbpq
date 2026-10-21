// Third-party license notices for the code bundled into dist/ui/*.js.
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

/** One preserved block comment; "*" + "/" inside a notice is broken up so it cannot close it early. */
export function noticeBanner(nodeModules = NODE_MODULES) {
  const body = thirdPartyNotices(nodeModules).replace(/\*\//g, '* /').replace(/##/g, '# #');
  return `/*! Third-party code bundled in this file, under its own license:\n\n${body}\n*/\n`;
}
