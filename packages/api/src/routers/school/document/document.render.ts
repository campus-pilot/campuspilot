import Handlebars from "handlebars";
import sanitizeHtml from "sanitize-html";
import { env } from "@campuspilot/env/server";
import { rpcError } from "../../../errors";
import { ORPCError } from "@orpc/server";
import type {
  DocumentTemplatePageSize,
  DocumentType,
} from "./document.dto";

const handlebars = Handlebars.create();
/** The v1 timetable's colspan helper accepts finite numeric operands only. */
handlebars.registerHelper("add", (a: unknown, b: unknown) => {
  if (
    typeof a !== "number" ||
    typeof b !== "number" ||
    !Number.isFinite(a) ||
    !Number.isFinite(b)
  )
    throw new Error("add requires finite numbers");
  return a + b;
});

/**
 * Every helper a template may call: the documented `each`, `if`, `unless`,
 * `with`, `lookup` and `add`. This is an allowlist, not a blocklist: a
 * Handlebars environment starts with more built-ins than templates are
 * promised (`log` writes its arguments to the server's console at a level
 * the author chooses, with no size limit), so everything not listed here is
 * unregistered and a call to it is a "missing helper" BAD_REQUEST. A
 * helper added by a future Handlebars release is refused until it is listed.
 */
export const DOCUMENT_TEMPLATE_HELPERS = [
  "each",
  "if",
  "unless",
  "with",
  "lookup",
  "add",
] as const;
/**
 * Not callable features but the runtime's hooks for `{{#section}}` on a
 * context value and for a call to an unknown helper (which throws).
 */
const RUNTIME_HELPER_HOOKS = ["helperMissing", "blockHelperMissing"];
/** Wraps every `{{value}}` so its output is counted; see {@link instrument}. */
const OUTPUT_METER_HELPER = "__documentOutput";

for (const name of Object.keys(handlebars.helpers)) {
  if (
    !(DOCUMENT_TEMPLATE_HELPERS as readonly string[]).includes(name) &&
    !RUNTIME_HELPER_HOOKS.includes(name)
  )
    handlebars.unregisterHelper(name);
}

/** The helpers registered on the restricted instance (for tests of the allowlist). */
export function registeredDocumentHelpers(): string[] {
  return Object.keys(handlebars.helpers).sort();
}

/** The ceiling of one rendered document, in characters, unless a caller sets a lower one. */
export const DOCUMENT_RENDER_MAX_CHARS = 25_000_000;
const OVERSIZE_MESSAGE =
  "This document exceeds the rendering limit. Use a shorter template, fewer repeated blocks or smaller images.";

/**
 * The output budget of the render in progress. Rendering is synchronous, so
 * one module-level meter belongs to exactly one `renderDocument` call.
 *
 * Why the budget is enforced while rendering and not on the result: a
 * template multiplies. `{{{school.logoUrl}}}` written a few thousand times,
 * or nested `each` blocks around one large value, make Handlebars build a
 * string of hundreds of megabytes before any check on the finished string
 * can run. The meter counts every character as it is produced and aborts
 * the render at the limit, so a hostile or mistaken template costs at most
 * the budget, whatever the context holds.
 */
let activeMeter: { used: number; limit: number } | null = null;

function spend(chars: number) {
  if (!activeMeter || chars <= 0) return;
  activeMeter.used += chars;
  if (activeMeter.used > activeMeter.limit)
    throw rpcError.badRequest(OVERSIZE_MESSAGE);
}

handlebars.registerHelper(OUTPUT_METER_HELPER, (value: unknown) => {
  if (value !== null && value !== undefined)
    spend(typeof value === "string" ? value.length : String(value).length);
  return value;
});

type BlockProgram = ((context: unknown, options?: unknown) => string) &
  Record<string, unknown>;

/**
 * Counts what one run of a block body adds: its output minus whatever the
 * body already counted itself (the values and nested blocks inside it), so
 * every character is counted once and a repeated body is counted per run.
 */
function meteredProgram(program: BlockProgram | undefined) {
  if (typeof program !== "function") return program;
  const metered = (context: unknown, options?: unknown) => {
    const before = activeMeter?.used ?? 0;
    const output = program(context, options);
    if (activeMeter) spend(output.length - (activeMeter.used - before));
    return output;
  };
  // Handlebars reads `program`, `depth` and `blockParams` off the function.
  return Object.assign(metered, program);
}

// Everything that can run a block body goes through the meter: the block
// helpers and the hook behind `{{#value}}…{{/value}}` sections.
for (const name of ["each", "if", "unless", "with", "blockHelperMissing"]) {
  const original = handlebars.helpers[name] as (
    this: unknown,
    ...args: unknown[]
  ) => unknown;
  handlebars.registerHelper(name, function (this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as {
      fn?: BlockProgram;
      inverse?: BlockProgram;
    };
    options.fn = meteredProgram(options.fn);
    options.inverse = meteredProgram(options.inverse);
    return original.apply(this, args);
  });
}

/**
 * Rewrites every `{{expression}}` to `{{__documentOutput expression}}` so the
 * length of each printed value is counted the moment it is produced (also
 * outside any block, where no block body would count it). The expression,
 * its escaping and its whitespace control are unchanged.
 */
function instrument(node: hbs.AST.Node | null | undefined): void {
  if (!node) return;
  if (node.type === "Program") {
    for (const statement of (node as hbs.AST.Program).body)
      instrument(statement);
    return;
  }
  if (
    node.type === "BlockStatement" ||
    node.type === "DecoratorBlock" ||
    node.type === "PartialBlockStatement"
  ) {
    const block = node as hbs.AST.BlockStatement;
    instrument(block.program);
    instrument(block.inverse);
    return;
  }
  if (node.type !== "MustacheStatement") return;
  const mustache = node as hbs.AST.MustacheStatement;
  const isCall =
    mustache.params.length > 0 || (mustache.hash?.pairs.length ?? 0) > 0;
  const expression = isCall
    ? ({
        type: "SubExpression",
        path: mustache.path,
        params: mustache.params,
        hash: mustache.hash,
        loc: mustache.loc,
      } as hbs.AST.SubExpression)
    : mustache.path;
  mustache.path = {
    type: "PathExpression",
    data: false,
    depth: 0,
    parts: [OUTPUT_METER_HELPER],
    original: OUTPUT_METER_HELPER,
    loc: mustache.loc,
  } as hbs.AST.PathExpression;
  mustache.params = [expression];
  mustache.hash = undefined as unknown as hbs.AST.Hash;
}
/** The only image sources a document may carry (no SVG, no network). */
const EMBEDDABLE_IMAGE = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i;
const policy =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const options: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "html",
    "head",
    "body",
    "style",
    "img",
    "main",
    "header",
    "footer",
  ],
  allowedAttributes: {
    "*": ["class", "style", "id"],
    img: ["src", "alt", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
  },
  allowedSchemes: ["data"],
  allowedSchemesByTag: { img: ["data"] },
  allowProtocolRelative: false,
  allowVulnerableTags: true,
  exclusiveFilter: (frame) =>
    frame.tag === "img" && !EMBEDDABLE_IMAGE.test(frame.attribs.src ?? ""),
};
/** The CSP is inserted before all user markup. Sanitization removes active
 * elements and attributes; data-only images keep previews and Chromium offline.
 * Handlebars' own-property lookup protections remain enabled.
 */
function safeHtml(raw: string) {
  if (Buffer.byteLength(raw, "utf8") > 25_000_000)
    throw rpcError.badRequest(
      "This document exceeds the 25 MB rendering limit. Select fewer students or use smaller photos.",
    );
  const clean = sanitizeHtml(raw, {
    ...options,
    allowedTags: (options.allowedTags as string[]).filter(
      (tag) => !["html", "head", "body"].includes(tag),
    ),
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body>${clean}</body></html>`;
}
/** Whether a value is an image the sanitizer keeps: a base64 PNG, JPEG or WebP data URI. */
export function isEmbeddableDocumentImage(value: string) {
  return EMBEDDABLE_IMAGE.test(value);
}

/**
 * Renders one template against one context with the restricted Handlebars
 * instance (allowlisted helpers only) and returns sanitized, CSP-wrapped
 * HTML. The output is capped at `maxOutputChars` **while it is produced**
 * (see the meter above); invalid syntax, an unknown helper and an oversized
 * result are all BAD_REQUEST.
 */
export function renderDocument(
  content: string,
  context: object,
  options: { maxOutputChars?: number } = {},
) {
  const meter = {
    used: 0,
    limit: options.maxOutputChars ?? DOCUMENT_RENDER_MAX_CHARS,
  };
  try {
    const program = handlebars.parse(content);
    instrument(program);
    const template = handlebars.compile(program);
    activeMeter = meter;
    // Text outside every block is printed exactly once.
    spend(content.length);
    const raw = template(context);
    activeMeter = null;
    return safeHtml(raw);
  } catch (cause) {
    if (cause instanceof ORPCError) throw cause;
    throw rpcError.badRequest(
      "The template contains invalid Handlebars syntax or an unsupported helper.",
      cause,
    );
  } finally {
    activeMeter = null;
  }
}
function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

/** Margin of every physical page of a flowing notice. */
const NOTICE_PAGE_MARGIN = "16mm";

/**
 * Notices flow: their length is whatever the author wrote, so they are not
 * clipped to one fixed sheet like every other document. Each notice starts
 * on a new portrait A4 page and continues over as many pages as it needs.
 * The page margin belongs to `@page`, so every continuation page keeps it
 * (padding on the template's root would apply to the first and last page
 * only). On screen (the sandboxed preview, where `@page` does not apply) the
 * same margin is shown as padding around an A4-wide column.
 */
function flowingNoticeLayout(documents: string[]) {
  const notices = documents
    .map((doc) => `<article class="notice-document">${doc}</article>`)
    .join("");
  return `<div class="batch">${notices}</div><style>@page{size:A4;margin:${NOTICE_PAGE_MARGIN}}html,body{margin:0!important;padding:0!important}.notice-document{box-sizing:border-box;width:100%;break-after:page;overflow-wrap:anywhere}.notice-document:last-child{break-after:auto}@media screen{.notice-document{max-width:210mm;margin:0 auto;padding:${NOTICE_PAGE_MARGIN}}}</style>`;
}

/** Templates own the design inside one slot; this wrapper exclusively owns
 * physical A4 imposition. Half templates are paired vertically, ID cards are
 * placed eight-up, and every other document gets one physical sheet, except
 * notices, which flow over as many pages as they need
 * ({@link flowingNoticeLayout}).
 */
export function combineDocuments(
  documents: string[],
  type: DocumentType,
  pageSize: DocumentTemplatePageSize = "full",
) {
  if (
    documents.reduce((size, doc) => size + Buffer.byteLength(doc, "utf8"), 0) >
    25_000_000
  )
    throw rpcError.badRequest(
      "This document exceeds the 25 MB rendering limit. Select fewer students or use smaller photos.",
    );
  if (type === "notice") return safeHtml(flowingNoticeLayout(documents));
  const landscape = type === "timetable";
  const perSheet = type === "id_card" ? 8 : pageSize === "half" ? 2 : 1;
  const sheets = chunks(documents, perSheet)
    .map(
      (sheet) =>
        `<section class="print-sheet">${sheet
          .map((doc) => `<article class="sheet-item">${doc}</article>`)
          .join("")}</section>`,
    )
    .join("");
  const layout =
    type === "id_card"
      ? ".print-sheet{padding:12mm;display:grid;grid-template-columns:86mm 86mm;grid-auto-rows:54mm;gap:5mm;align-content:start}"
      : pageSize === "half"
        ? ".print-sheet{display:grid;grid-template-rows:148.5mm 148.5mm}"
        : "";
  const width = landscape ? "297mm" : "210mm";
  const height = landscape ? "210mm" : "297mm";
  const html = `<div class="batch">${sheets}</div><style>@page{size:${landscape ? "A4 landscape" : "A4"};margin:0}html,body{margin:0!important;padding:0!important}.print-sheet{box-sizing:border-box;width:${width};height:${height};overflow:hidden;break-after:page}.print-sheet:last-child{break-after:auto}.sheet-item{width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;break-inside:avoid}${layout}</style>`;
  return safeHtml(html);
}
export async function convertDocumentPdf(
  html: string,
  type: DocumentType,
  signal?: AbortSignal,
) {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("paperWidth", type === "timetable" ? "11.7" : "8.27");
  form.append("paperHeight", type === "timetable" ? "8.27" : "11.7");
  form.append("preferCssPageSize", "true");
  form.append("printBackground", "true");
  const response = await fetch(
    `${env.GOTENBERG_URL.replace(/\/$/, "")}/forms/chromium/convert/html`,
    {
      method: "POST",
      body: form,
      signal: AbortSignal.any([
        AbortSignal.timeout(120_000),
        ...(signal ? [signal] : []),
      ]),
    },
  );
  if (!response.ok)
    throw new Error(`PDF conversion failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 30_000_000 || bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new Error("PDF converter returned an invalid or oversized document.");
  return bytes;
}
