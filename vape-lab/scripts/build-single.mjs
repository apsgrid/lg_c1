// Inline the Vite build into one self-contained HTML file (dist/vape-lab.html)
// so the lab can be hosted as a single page and opened on a phone.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(import.meta.dirname, '..', 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8'));
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8'));
const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');

const page = `<title>Vape Lab</title>
<meta name="description" content="Vape Wars: Vape Lab demo. A fictional flavour-design minigame.">
<meta name="claude:viewport-fit-sides" content="cover">
<style>${safe(css.join('\n'))}</style>
<div id="app"></div>
<script type="module">${safe(js.join('\n'))}</script>
`;
writeFileSync(join(dist, 'vape-lab.html'), page);
console.log(`dist/vape-lab.html ${(page.length / 1024).toFixed(0)} KB`);
