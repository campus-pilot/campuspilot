/** Builds preview.html from preview.template.html, embedding every .svg here so the page works as a standalone snapshot. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url);
const svg = Object.fromEntries(
  readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => [f, 'data:image/svg+xml;base64,' + readFileSync(new URL(f, dir)).toString('base64')]),
);
writeFileSync(new URL('preview.html', dir), readFileSync(new URL('preview.template.html', dir), 'utf8').replace('__SVG__', JSON.stringify(svg)));
