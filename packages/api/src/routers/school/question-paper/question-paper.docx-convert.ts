import { env } from '@campuspilot/env/server';
import { annotateTiming, measure } from '@campuspilot/logger/perf';
import sharp from 'sharp';

import { rpcError } from '../../../errors';
import { QUESTION_PAPER_DOCUMENT_MAX_BYTES } from './question-paper.body';
import { imageTypeOf } from './question-paper.docx-images';
import type { DocxSvg, QuestionPaperDocxHtml } from './question-paper.docx-html';
import { buildReferenceDocx, isZipPackage, packageQuestionPaperDocx } from './question-paper.docx-package';

/**
 * The Word (.docx) converter client (docs/question-papers.md "Word download").
 *
 * Pandoc runs as its own service (`PANDOC_URL`, the official image in `pandoc
 * server` mode), like Gotenberg for PDFs. Server mode is sandboxed: it reads no
 * file and fetches no URL, only what the request carries. The request is JSON:
 * `text` (the HTML of `question-paper.docx-html.ts`), `from`
 * (`html+tex_math_single_backslash`, so `\(…\)` becomes a Word equation), `to:
 * docx`, `reference-doc` naming a file of `files`, and `files`, a map from file
 * name to base64 bytes: the reference document and every image the HTML names.
 * With `Accept: application/json` it answers `{ output, base64: true, messages }`
 * with the .docx in base64, or `{ error }` (HTTP 200 either way).
 *
 * SVG diagrams are rasterised by Gotenberg's Chromium (its screenshot route),
 * not `sharp`: the API image has no fonts, so `sharp` draws every letter of an
 * SVG's text as an empty box, and Chromium has the same Noto fonts the PDF is
 * printed with.
 */

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** How long Pandoc may work on one paper (it is told 25 s itself), and how long one diagram may take to draw. */
const CONVERSION_TIMEOUT_MS = 30_000;
const SVG_TIMEOUT_MS = 20_000;
/** The largest .docx accepted back, and the largest converter answer read (base64 and JSON around it). */
const MAX_DOCX_BYTES = 40_000_000;
const MAX_RESPONSE_BYTES = Math.ceil((MAX_DOCX_BYTES * 4) / 3) + 1_000_000;
/** The largest rasterised diagram accepted, and its longest side in device pixels (it is drawn at up to three times its size). */
const MAX_SVG_PNG_BYTES = 10_000_000;
const MAX_SVG_RASTER_SIDE = 3_000;
/** Diagrams drawn at the same time (one Chromium request each). */
const SVG_CONCURRENCY = 2;

/** Reads a response body up to `limit` bytes; a longer one is refused without being read to the end. */
async function boundedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) throw new Error('The converter answer is too large.');
  if (!response.body) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('The converter answer is too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** One diagram as a PNG, drawn by Chromium at up to three times its size so it stays sharp in print. */
async function rasteriseSvg(svg: DocxSvg, signal?: AbortSignal): Promise<Buffer> {
  const scale = Math.min(3, MAX_SVG_RASTER_SIDE / Math.max(svg.width, svg.height));
  const width = Math.max(1, Math.round(svg.width * scale));
  const height = Math.max(1, Math.round(svg.height * scale));
  // The SVG was serialised by our code from sanitiser output (no script, URL or foreign object); Gotenberg runs with
  // JavaScript off and no network. `zoom` scales a drawing with or without a viewBox.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><div style="zoom:${scale.toFixed(3)};width:${svg.width}px;height:${svg.height}px;overflow:hidden;font-family:'Noto Sans','Noto Sans Devanagari',sans-serif">${svg.svg}</div></body></html>`;
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('width', String(width));
  form.append('height', String(height));
  form.append('clip', 'true');
  form.append('format', 'png');
  const response = await fetch(`${env.GOTENBERG_URL.replace(/\/$/, '')}/forms/chromium/screenshot/html`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.any([AbortSignal.timeout(SVG_TIMEOUT_MS), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error(`Diagram rasterising failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SVG_PNG_BYTES || imageTypeOf(bytes) !== 'image/png') throw new Error('Diagram rasterising returned an invalid image.');
  return bytes;
}

async function rasteriseAll(svgs: readonly DocxSvg[], signal?: AbortSignal): Promise<Array<[string, Buffer]>> {
  const out: Array<[string, Buffer]> = [];
  for (let start = 0; start < svgs.length; start += SVG_CONCURRENCY) {
    const batch = svgs.slice(start, start + SVG_CONCURRENCY);
    out.push(...(await Promise.all(batch.map(async (svg) => [svg.name, await rasteriseSvg(svg, signal)] as [string, Buffer]))));
  }
  return out;
}

type PandocAnswer = { output?: unknown; base64?: unknown; error?: unknown; messages?: unknown };

/**
 * Converts the Word-friendly HTML of a version to the finished .docx: diagrams
 * rasterised, WebP images (a template's logo may be one; Word cannot show it)
 * turned into PNG, Pandoc with this paper's reference document, then the
 * package fix-ups. The input (HTML and images) is held to the document system's
 * 25 MB budget, like a PDF's.
 */
export async function convertQuestionPaperDocx(input: QuestionPaperDocxHtml, signal?: AbortSignal): Promise<Buffer> {
  const svgFiles = await measure('qp.docx.svg', () => rasteriseAll(input.svgs, signal));
  const imageFiles = await measure('qp.docx.images', () =>
    Promise.all(input.images.map(async (image) => [image.name, image.type === 'image/webp' ? await sharp(image.bytes).png().toBuffer() : image.bytes] as [string, Buffer])),
  );
  const files = [...imageFiles, ...svgFiles];
  const inputBytes = Buffer.byteLength(input.html, 'utf8') + files.reduce((sum, [, bytes]) => sum + bytes.length, 0);
  if (inputBytes > QUESTION_PAPER_DOCUMENT_MAX_BYTES) throw rpcError.badRequest('This paper is too large to convert to Word. Use fewer or smaller figures.');
  const reference = buildReferenceDocx(input.footer);
  const body = JSON.stringify({
    text: input.html,
    from: 'html+tex_math_single_backslash',
    to: 'docx',
    'reference-doc': 'qp-reference.docx',
    files: Object.fromEntries([['qp-reference.docx', Buffer.from(reference).toString('base64')], ...files.map(([name, bytes]) => [name, bytes.toString('base64')])]),
  });
  // Pandoc works in its own container: this step is waiting, not CPU in this process.
  const answer = await measure('qp.docx.convert', async () => {
    const response = await fetch(`${env.PANDOC_URL.replace(/\/$/, '')}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      signal: AbortSignal.any([AbortSignal.timeout(CONVERSION_TIMEOUT_MS), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error(`Word conversion failed (${response.status}).`);
    return JSON.parse(await boundedText(response, MAX_RESPONSE_BYTES)) as PandocAnswer;
  });
  if (typeof answer.error === 'string') throw new Error(`Word conversion failed: ${answer.error.slice(0, 300)}`);
  if (answer.base64 !== true || typeof answer.output !== 'string') throw new Error('The Word converter returned an unexpected answer.');
  const converted = Buffer.from(answer.output, 'base64');
  if (converted.length > MAX_DOCX_BYTES || !isZipPackage(converted)) throw new Error('The Word converter returned an invalid or oversized document.');
  const docx = Buffer.from(measure('qp.docx.package', () => packageQuestionPaperDocx(converted, input.tables)));
  annotateTiming({
    docxHtmlBytes: Buffer.byteLength(input.html, 'utf8'),
    docxBytes: docx.length,
    docxTables: input.tables.length,
    docxImages: input.images.length,
    docxSvgs: input.svgs.length,
    docxWarnings: Array.isArray(answer.messages) ? answer.messages.filter((message) => (message as { verbosity?: unknown })?.verbosity === 'WARNING').length : 0,
  });
  return docx;
}
