import { env } from '@campuspilot/env/server';
import { annotateTiming, measure } from '@campuspilot/logger/perf';
import sharp from 'sharp';

import { rpcError } from '../../../errors';
import { QUESTION_PAPER_DOCUMENT_MAX_BYTES } from './question-paper.body';
import { documentContentSecurityPolicy } from '../document/document.render';
import { imageTypeOf } from './question-paper.docx-images';
import { DOCX_MAX_IMAGE_PIXELS, type DocxSvg, type QuestionPaperDocxHtml } from './question-paper.docx-html';
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
 *
 * Load: conversions are expensive for the shared services (a request of up to
 * 25 MB to Pandoc, up to 40 diagrams on Gotenberg), so this process runs at most
 * {@link MAX_CONCURRENT_CONVERSIONS} at a time, one per version
 * ({@link sharedDocxConversion}), each within one deadline.
 */

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The deadline of one whole conversion (waiting for a slot, drawing diagrams, Pandoc, packaging and storing), and how
 * long Pandoc may work within it (it is told 25 s itself) and one diagram may take to draw.
 */
const DOCX_CONVERSION_DEADLINE_MS = 60_000;
const CONVERSION_TIMEOUT_MS = 30_000;
const SVG_TIMEOUT_MS = 20_000;
/** Word conversions this process runs at the same time; more wait their turn. */
const MAX_CONCURRENT_CONVERSIONS = 2;
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
async function rasteriseSvg(svg: DocxSvg, signal: AbortSignal): Promise<Buffer> {
  const scale = Math.min(3, MAX_SVG_RASTER_SIDE / Math.max(svg.width, svg.height));
  const width = Math.max(1, Math.round(svg.width * scale));
  const height = Math.max(1, Math.round(svg.height * scale));
  // The SVG was serialised by our code from sanitiser output (no script, URL or foreign object). What this path relies
  // on is the page's own Content-Security-Policy, the one every printed document gets (no script, no network, images
  // and fonts from data URIs only): whether the Gotenberg it reaches also runs with JavaScript off and no egress
  // depends on that deployment (the dev, local-demo and test stacks do). `zoom` scales a drawing with or without a viewBox.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${documentContentSecurityPolicy('question_paper')}"><style>html,body{margin:0;background:#fff}</style></head><body><div style="zoom:${scale.toFixed(3)};width:${svg.width}px;height:${svg.height}px;overflow:hidden;font-family:'Noto Sans','Noto Sans Devanagari',sans-serif">${svg.svg}</div></body></html>`;
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('width', String(width));
  form.append('height', String(height));
  form.append('clip', 'true');
  form.append('format', 'png');
  const response = await fetch(`${env.GOTENBERG_URL.replace(/\/$/, '')}/forms/chromium/screenshot/html`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.any([AbortSignal.timeout(SVG_TIMEOUT_MS), signal]),
  });
  if (!response.ok) throw new Error(`Diagram rasterising failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SVG_PNG_BYTES || imageTypeOf(bytes) !== 'image/png') throw new Error('Diagram rasterising returned an invalid image.');
  return bytes;
}

async function rasteriseAll(svgs: readonly DocxSvg[], signal: AbortSignal): Promise<Array<[string, Buffer]>> {
  const out: Array<[string, Buffer]> = [];
  for (let start = 0; start < svgs.length; start += SVG_CONCURRENCY) {
    const batch = svgs.slice(start, start + SVG_CONCURRENCY);
    out.push(...(await Promise.all(batch.map(async (svg) => [svg.name, await rasteriseSvg(svg, signal)] as [string, Buffer]))));
  }
  return out;
}

type PandocAnswer = { output?: unknown; base64?: unknown; error?: unknown; messages?: unknown };

/**
 * The image files of the request: stored figures and template images as they
 * are, a WebP (a template's logo may be one; Word cannot show it) turned into
 * PNG no larger than twice the size it is shown at. One at a time, each decode
 * held to {@link DOCX_MAX_IMAGE_PIXELS} (already checked from the header), the
 * running total held to the 25 MB budget so nothing more is converted once the
 * request could not be sent anyway.
 */
async function imageFilesOf(input: QuestionPaperDocxHtml, budget: { bytes: number }, signal: AbortSignal): Promise<Array<[string, Buffer]>> {
  const files: Array<[string, Buffer]> = [];
  for (const image of input.images) {
    signal.throwIfAborted();
    const bytes =
      image.type === 'image/webp'
        ? await sharp(image.bytes, { limitInputPixels: DOCX_MAX_IMAGE_PIXELS })
            .resize({ width: Math.max(1, Math.ceil(image.shown.width * 2)), withoutEnlargement: true })
            .png()
            .toBuffer()
        : image.bytes;
    spendInputBytes(budget, bytes.length);
    files.push([image.name, bytes]);
  }
  return files;
}

const TOO_LARGE = 'This paper is too large to convert to Word. Use fewer or smaller figures.';

/** Adds to the request's running size and refuses once it passes the document budget. */
function spendInputBytes(budget: { bytes: number }, bytes: number) {
  budget.bytes += bytes;
  if (budget.bytes > QUESTION_PAPER_DOCUMENT_MAX_BYTES) throw rpcError.badRequest(TOO_LARGE);
}

/**
 * Converts the Word-friendly HTML of a version to the finished .docx: images
 * ({@link imageFilesOf}) and diagrams, Pandoc with this paper's reference
 * document, then the package fix-ups. The input (HTML and images) is held to
 * the document system's 25 MB budget, like a PDF's. `signal` is the
 * conversion's deadline ({@link sharedDocxConversion}); it is checked between
 * the steps and given to every request.
 */
export async function convertQuestionPaperDocx(input: QuestionPaperDocxHtml, signal: AbortSignal): Promise<Buffer> {
  const budget = { bytes: 0 };
  spendInputBytes(budget, Buffer.byteLength(input.html, 'utf8'));
  const imageFiles = await measure('qp.docx.images', () => imageFilesOf(input, budget, signal));
  const svgFiles = await measure('qp.docx.svg', () => rasteriseAll(input.svgs, signal));
  for (const [, bytes] of svgFiles) spendInputBytes(budget, bytes.length);
  const files = [...imageFiles, ...svgFiles];
  signal.throwIfAborted();
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
      signal: AbortSignal.any([AbortSignal.timeout(CONVERSION_TIMEOUT_MS), signal]),
    });
    if (!response.ok) throw new Error(`Word conversion failed (${response.status}).`);
    return JSON.parse(await boundedText(response, MAX_RESPONSE_BYTES)) as PandocAnswer;
  });
  if (typeof answer.error === 'string') throw new Error(`Word conversion failed: ${answer.error.slice(0, 300)}`);
  if (answer.base64 !== true || typeof answer.output !== 'string') throw new Error('The Word converter returned an unexpected answer.');
  const converted = Buffer.from(answer.output, 'base64');
  if (converted.length > MAX_DOCX_BYTES || !isZipPackage(converted)) throw new Error('The Word converter returned an invalid or oversized document.');
  signal.throwIfAborted();
  const docx = Buffer.from(measure('qp.docx.package', () => packageQuestionPaperDocx(converted, input.tables)));
  annotateTiming({
    docxHtmlBytes: Buffer.byteLength(input.html, 'utf8'),
    docxBytes: docx.length,
    docxTables: input.tables.length,
    docxImages: input.images.length,
    docxSvgs: input.svgs.length,
    docxWorkUnits: input.workUnits,
    docxWarnings: Array.isArray(answer.messages) ? answer.messages.filter((message) => (message as { verbosity?: unknown })?.verbosity === 'WARNING').length : 0,
  });
  return docx;
}

/** A counting semaphore whose waiters can give up (their signal aborts) and leave the queue. */
class Slots {
  private free: number;
  private readonly waiting: Array<() => void> = [];

  constructor(count: number) {
    this.free = count;
  }

  async acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.free > 0) {
      this.free -= 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const take = () => {
        signal.removeEventListener('abort', leave);
        resolve();
      };
      const leave = () => {
        const index = this.waiting.indexOf(take);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal.reason);
      };
      this.waiting.push(take);
      signal.addEventListener('abort', leave, { once: true });
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.free += 1;
  }
}

const conversionSlots = new Slots(MAX_CONCURRENT_CONVERSIONS);
type SharedConversion = { promise: Promise<string>; controller: AbortController; waiters: number };
const inFlight = new Map<string, SharedConversion>();

/**
 * Runs `work` (a version's whole Word conversion, storing included) once per
 * `key` in this process: a request that asks while the same version is being
 * converted waits for that conversion instead of starting a second one. At
 * most {@link MAX_CONCURRENT_CONVERSIONS} conversions run at a time; the others
 * wait for a slot. The work gets ONE signal, its deadline: aborted after
 * {@link DOCX_CONVERSION_DEADLINE_MS} from its start (the wait for a slot
 * included), or when every request waiting for it has given up (`signal`).
 * Each request still leaves as soon as its own signal aborts.
 *
 * The dedupe is per process (the API runs one replica today). Several replicas
 * would each convert once; the version row's compare-and-set in
 * `storedVersionDocxKey` still keeps one file and discards the others.
 */
export function sharedDocxConversion(key: string, signal: AbortSignal | undefined, work: (deadline: AbortSignal) => Promise<string>): Promise<string> {
  let shared = inFlight.get(key);
  if (!shared) {
    const controller = new AbortController();
    const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(DOCX_CONVERSION_DEADLINE_MS)]);
    const promise = (async () => {
      await conversionSlots.acquire(deadline);
      try {
        return await work(deadline);
      } finally {
        conversionSlots.release();
      }
    })().finally(() => inFlight.delete(key));
    shared = { promise, controller, waiters: 0 };
    inFlight.set(key, shared);
  }
  const entry = shared;
  entry.waiters += 1;
  if (!signal) return entry.promise;
  return new Promise<string>((resolve, reject) => {
    const leave = () => {
      entry.waiters -= 1;
      if (entry.waiters === 0) entry.controller.abort(signal.reason);
      reject(signal.reason);
    };
    if (signal.aborted) return leave();
    signal.addEventListener('abort', leave, { once: true });
    entry.promise.then(
      (value) => {
        signal.removeEventListener('abort', leave);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', leave);
        reject(error);
      },
    );
  });
}
