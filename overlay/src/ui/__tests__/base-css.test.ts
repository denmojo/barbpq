import { readFileSync } from 'node:fs';

const css = readFileSync('src/ui/base.css', 'utf8');

test('base.css keeps color-scheme in step with data-theme, after the :root rule', () => {
  const root = css.indexOf(':root { color-scheme: light dark; }');
  const light = css.search(/\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;?\s*\}/);
  const dark = css.search(/\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;?\s*\}/);
  expect(root).toBeGreaterThan(-1);
  expect(light).toBeGreaterThan(root);
  expect(dark).toBeGreaterThan(root);
});
