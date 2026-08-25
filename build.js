#!/usr/bin/env node
// Bundles the game into one self-contained HTML file with no external requests,
// so it can be opened straight off disk or dropped on any static host.

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const OUT = resolve(ROOT, 'dist');

function section(html, name) {
  const re = new RegExp(`<!-- build:${name}:start -->([\\s\\S]*?)<!-- build:${name}:end -->`);
  const match = html.match(re);
  if (!match) throw new Error(`index.html is missing the "${name}" build markers`);
  return match[1].trim();
}

function between(html, open, close, label) {
  const start = html.indexOf(open);
  const end = html.indexOf(close, start);
  if (start === -1 || end === -1) throw new Error(`index.html is missing ${label}`);
  return html.slice(start + open.length, end).trim();
}

const html = await readFile(resolve(ROOT, 'index.html'), 'utf8');
const css = between(html, '<style>', '</style>', 'its <style> block');
const markup = section(html, 'markup');
const title = between(html, '<title>', '</title>', 'a <title>');
const favicon = html.match(/<link rel="icon"[^>]*>/)?.[0] ?? '';

// Tree-shaken IIFE: no imports left, so file:// works and no CSP is upset.
const bundle = await build({
  entryPoints: [resolve(ROOT, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2022'],
  legalComments: 'none',
  write: false,
});
const js = bundle.outputFiles[0].text;

await mkdir(OUT, { recursive: true });

// 1. Standalone document — double-click to play.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<title>${title}</title>
${favicon}
<style>
${css}
</style>
</head>
<body>
${markup}
<script>
${js}
</script>
</body>
</html>
`;
await writeFile(resolve(OUT, 'powder-line.html'), page);

// 2. Fragment for hosts that supply their own <head>/<body> skeleton.
const fragment = `<title>${title}</title>
<style>
${css}
</style>
${markup}
<script>
${js}
</script>
`;
await writeFile(resolve(OUT, 'powder-line.fragment.html'), fragment);

const kb = (s) => `${Math.round(s / 1024)} KB`;
console.log(`  dist/powder-line.html          ${kb(page.length)}`);
console.log(`  dist/powder-line.fragment.html ${kb(fragment.length)}`);
console.log(`  (bundled JS ${kb(js.length)})`);
