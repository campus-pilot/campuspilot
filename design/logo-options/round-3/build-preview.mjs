/** Builds preview.html from preview.template.html, inlining every .svg here as raw markup so the page works as a standalone snapshot and each cell can theme currentColor / --mark-accent. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url);
const svg = Object.fromEntries(
  readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]),
);
writeFileSync(new URL('preview.html', dir), readFileSync(new URL('preview.template.html', dir), 'utf8').replace('__SVG__', () => JSON.stringify(svg)));
