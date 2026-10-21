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
    frame.tag === "img" &&
    !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(
      frame.attribs.src ?? "",
    ),
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
export function renderDocument(content: string, context: object) {
  try {
    handlebars.precompile(content);
    const raw = handlebars.compile(content)(context);
    return safeHtml(raw);
  } catch (cause) {
    if (cause instanceof ORPCError) throw cause;
    throw rpcError.badRequest(
      "The template contains invalid Handlebars syntax or an unsupported helper.",
      cause,
    );
  }
}
function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

/** Templates own the design inside one slot; this wrapper exclusively owns
 * physical A4 imposition. Half templates are paired vertically, ID cards are
 * placed eight-up, and every other document gets one physical sheet.
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
