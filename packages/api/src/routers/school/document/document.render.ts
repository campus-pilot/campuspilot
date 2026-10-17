import Handlebars from "handlebars";
import sanitizeHtml from "sanitize-html";
import { env } from "@campuspilot/env/server";
import { rpcError } from "../../../errors";
import { ORPCError } from "@orpc/server";
import type { DocumentType } from "./document.dto";

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
/** Each report/admit card starts on a page; ID cards are imposed on A4 sheets.
 * The template controls card design while this wrapper controls batch layout.
 */
export function combineDocuments(documents: string[], type: DocumentType) {
  const layout =
    type === "id_card"
      ? ".batch{display:grid;grid-template-columns:86mm 86mm;gap:5mm;align-content:start}.sheet-item{break-inside:avoid}"
      : ".sheet-item{break-after:page}.sheet-item:last-child{break-after:auto}";
  if (
    documents.reduce((size, doc) => size + Buffer.byteLength(doc, "utf8"), 0) >
    25_000_000
  )
    throw rpcError.badRequest(
      "This document exceeds the 25 MB rendering limit. Select fewer students or use smaller photos.",
    );
  const html = `<style>@page{size:${type === "timetable" ? "A4 landscape" : "A4"};margin:12mm}${layout}</style><div class="batch">${documents.map((doc) => `<article class="sheet-item">${doc}</article>`).join("")}</div>`;
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
