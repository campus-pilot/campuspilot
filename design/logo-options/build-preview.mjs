/**
 * Builds the local preview (preview.html) and the publishable review page (review.html) from their templates,
 * inlining every .svg here as raw markup so each table cell can theme currentColor / --mark-accent.
 * review.html also takes the option list from preview.template.html so both pages always show the same rows.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const svg = JSON.stringify(
  Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => [f, read(f)])),
);
const preview = read('preview.template.html');
writeFileSync(new URL('preview.html', dir), preview.replace('__SVG__', () => svg));
const options = preview.match(/const options = (\[[\s\S]*?\n  \]);/)[1];
writeFileSync(
  new URL('review.html', dir),
  read('review.template.html').replace('__OPTIONS__', () => options).replace('__SVG__', () => svg),
);
