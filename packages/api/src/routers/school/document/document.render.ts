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
 * The helpers that may open a block (`{{#each}}…{{/each}}`). Each of them
 * returns nothing but the output of the block bodies it ran, which the
 * bodies count themselves. `lookup` and `add` return a context value, so in
 * block form their result would be printed without passing a counted
 * `{{value}}`: they are expression helpers only ({@link prepareTemplate}).
 */
export const DOCUMENT_TEMPLATE_BLOCK_HELPERS = [
  "each",
  "if",
  "unless",
  "with",
] as const;
/**
 * Not callable features but the runtime's hooks for `{{#section}}` on a
 * context value and for a call to an unknown helper (which throws).
 */
const RUNTIME_HELPER_HOOKS = ["helperMissing", "blockHelperMissing"];
/**
 * Names beginning with this belong to the renderer's own accounting helpers.
 * A template that mentions one anywhere is refused before it is compiled.
 */
const RESERVED_PREFIX = "__document";
/** Counts one run of a block body or of the template itself: its static text plus one step. */
const RUN_METER_HELPER = `${RESERVED_PREFIX}Run`;
/** Counts and escapes the value of one `{{value}}`. */
const OUTPUT_METER_HELPER = `${RESERVED_PREFIX}Output`;
/** Counts the value of one `{{{value}}}` or `{{&value}}`. */
const RAW_OUTPUT_METER_HELPER = `${RESERVED_PREFIX}RawOutput`;

for (const name of Object.keys(handlebars.helpers)) {
  if (
    !(DOCUMENT_TEMPLATE_HELPERS as readonly string[]).includes(name) &&
    !RUNTIME_HELPER_HOOKS.includes(name)
  )
    handlebars.unregisterHelper(name);
}
// No decorators and no partials exist on this instance: `inline` (the
// built-in decorator that defines inline partials) is removed, and the
// parse-time check below refuses their syntax for every template.
for (const name of Object.keys(
  (handlebars as unknown as { decorators: Record<string, unknown> }).decorators,
))
  handlebars.unregisterDecorator(name);

/** The helpers registered on the restricted instance (for tests of the allowlist). */
export function registeredDocumentHelpers(): string[] {
  return Object.keys(handlebars.helpers).sort();
}
/** The decorators and partials registered on the restricted instance: none (for tests). */
export function registeredDocumentPartialsAndDecorators(): string[] {
  const instance = handlebars as unknown as {
    decorators: Record<string, unknown>;
    partials: Record<string, unknown>;
  };
  return [...Object.keys(instance.decorators), ...Object.keys(instance.partials)];
}

/** The ceiling of one render, in budget units (see {@link RenderMeter}), unless a caller sets a lower one. */
export const DOCUMENT_RENDER_MAX_CHARS = 25_000_000;
const OVERSIZE_MESSAGE =
  "This document exceeds the rendering limit. Use a shorter template, fewer repeated blocks or smaller images.";
const PARTIAL_MESSAGE =
  "Templates cannot use partials, inline partials or decorators.";
const UNCOUNTED_MESSAGE =
  "The template uses a construct that is not supported.";

/**
 * The render budget: how the cost of a render is bounded **while** it runs.
 *
 * Why not check the finished string: a template multiplies. A large value
 * printed a few thousand times, or nested `each` blocks, make Handlebars
 * build hundreds of megabytes before any check on the result can run.
 *
 * Design: every construct that can produce output is either counted here or
 * refused when the template is parsed. There is no third category, and
 * counting does not depend on which helper ran a block.
 *
 * | Construct | Decision |
 * | --- | --- |
 * | Static text | counted per run of the body it is written in (`__documentRun`, inserted first in every body) |
 * | `{{value}}`, `{{helper a b}}`, `{{@index}}`, `{{../a}}`, block params | counted after escaping (`__documentOutput` wraps the expression) |
 * | `{{{value}}}`, `{{&value}}` | counted (`__documentRawOutput`) |
 * | Sub-expressions `(lookup a b)`, hash arguments | produce no output; printed only through one of the two rows above |
 * | `{{#each}}`, `{{#if}}`, `{{#unless}}`, `{{#with}}`, `{{else}}`, `{{else if}}`, `{{^}}` | output is the bodies they run: each run counts itself; every run also costs one step plus one per statement in the body, so loops that print nothing are bounded too |
 * | `{{#value}}…{{/value}}` sections (incl. `{{{{raw}}}}`) | as above (the runtime's `blockHelperMissing` only runs bodies) |
 * | `{{#lookup}}`, `{{#add}}`, any other registered helper as a block | refused at parse time (their result would be printed uncounted) |
 * | `{{> partial}}`, `{{#> partial}}`, `{{#*inline}}`, `{{* decorator}}` | refused at parse time; none is registered |
 * | Any AST node type this file does not know | refused at parse time |
 *
 * `chars` is therefore exactly the length of the rendered string, and the
 * render is refused if the two ever differ ({@link runMetered}): a
 * construct that produced output without being counted cannot pass, even one
 * a future Handlebars release adds. As a second line of defence every
 * registered helper called as a block has its result charged
 * ({@link meterBlockResults}).
 *
 * Rendering is synchronous, so one module-level meter belongs to exactly one
 * render call (one document, or one batch sharing a budget).
 */
type RenderMeter = {
  /** Characters produced so far. */
  chars: number;
  /**
   * Work that need not print anything: one unit per run of a block body (or
   * of the template) plus one per expression or block written in that body,
   * so loops that print nothing still end, and in time proportional to the budget.
   */
  steps: number;
  /** The most `chars + steps` may reach. */
  limit: number;
};
let activeMeter: RenderMeter | null = null;

/** The meter of the render in progress. Templates of this instance only ever run inside {@link runMetered}. */
function meter(): RenderMeter {
  if (!activeMeter)
    throw new Error("A document template ran outside a metered render.");
  return activeMeter;
}

function spend(chars: number, steps = 0) {
  const current = meter();
  if (chars > 0) current.chars += chars;
  current.steps += steps;
  if (current.chars + current.steps > current.limit)
    throw rpcError.badRequest(OVERSIZE_MESSAGE);
}

/**
 * One run of a body: its static text, and as steps one for the run plus one
 * per expression or block written directly in it. Charging the expressions
 * makes the work of a run (not only its output) count: a body of thousands
 * of `{{missing}}` inside nested loops prints nothing, yet each run
 * evaluates every one of them.
 */
handlebars.registerHelper(
  RUN_METER_HELPER,
  (staticChars: unknown, statements: unknown) => {
    spend(
      typeof staticChars === "number" ? staticChars : 0,
      1 + (typeof statements === "number" ? statements : 0),
    );
    return "";
  },
);
handlebars.registerHelper(OUTPUT_METER_HELPER, (value: unknown) => {
  // Refuse a value that cannot fit before allocating its escaped copy.
  if (typeof value === "string") {
    const current = meter();
    if (current.chars + current.steps + value.length > current.limit)
      throw rpcError.badRequest(OVERSIZE_MESSAGE);
  }
  const text = handlebars.escapeExpression(value as string);
  spend(text.length);
  // Already escaped: Handlebars appends a SafeString as it is.
  return new handlebars.SafeString(text);
});
handlebars.registerHelper(RAW_OUTPUT_METER_HELPER, (value: unknown) => {
  if (value === null || value === undefined) return value;
  // What `{{{value}}}` appends: the value's string form.
  const text = typeof value === "string" ? value : `${value as string}`;
  spend(text.length);
  return text;
});

/**
 * Second line of defence behind the parse-time rule on block helpers: when
 * any registered helper is called as a block, whatever its result holds
 * beyond what its bodies already counted is charged. For `each`, `if`,
 * `unless`, `with` and sections that is always nothing. It is applied to
 * every helper on the instance, so one registered later cannot be forgotten
 * (the allowlist test pins the list).
 */
function meterBlockResults() {
  for (const name of Object.keys(handlebars.helpers)) {
    if (name.startsWith(RESERVED_PREFIX)) continue;
    const original = handlebars.helpers[name] as (
      this: unknown,
      ...args: unknown[]
    ) => unknown;
    handlebars.registerHelper(name, function (this: unknown, ...args: unknown[]) {
      const options = args[args.length - 1] as { fn?: unknown } | undefined;
      // Handlebars passes `fn` exactly when the helper opened a block.
      if (typeof options?.fn !== "function") return original.apply(this, args);
      const before = meter().chars;
      const result = original.apply(this, args);
      if (result !== null && result !== undefined)
        spend(`${result as string}`.length - (meter().chars - before));
      return result;
    });
  }
}
meterBlockResults();

type TemplateHead = hbs.AST.PathExpression | hbs.AST.Literal;
type CallNode = {
  path: TemplateHead | hbs.AST.SubExpression;
  params: hbs.AST.Expression[];
  hash?: hbs.AST.Hash;
};

function refuse(message: string): never {
  throw rpcError.badRequest(message);
}

function helperPath(name: string, loc: hbs.AST.SourceLocation) {
  return {
    type: "PathExpression",
    data: false,
    depth: 0,
    parts: [name],
    original: name,
    loc,
  } as hbs.AST.PathExpression;
}

/**
 * `{{"name" …}}` and `{{1}}` are path lookups to Handlebars' compiler, so a
 * literal in head position can name a helper. It is turned into the path the
 * compiler would make of it before any rule below looks at the name.
 */
function headPath(node: CallNode): hbs.AST.PathExpression {
  const head = node.path as hbs.AST.Node;
  if (head.type === "PathExpression") return head as hbs.AST.PathExpression;
  if (
    head.type !== "StringLiteral" &&
    head.type !== "NumberLiteral" &&
    head.type !== "BooleanLiteral" &&
    head.type !== "UndefinedLiteral" &&
    head.type !== "NullLiteral"
  )
    refuse(UNCOUNTED_MESSAGE);
  const literal = head as hbs.AST.Literal & { original: unknown };
  const path = helperPath(`${literal.original as string}`, literal.loc);
  node.path = path;
  return path;
}

/** Whether a name is a helper of the instance (never a prototype member). */
function isRegisteredHelper(name: string | undefined) {
  return name !== undefined && Object.hasOwn(handlebars.helpers, name);
}

/** Handlebars' `simpleId`: one part, not `this.x`, `./x` or `../x`. */
function isSimpleId(path: hbs.AST.PathExpression) {
  return (
    path.parts.length === 1 && !/^\.|this\b/.test(path.original) && !path.depth
  );
}

/** Checks one expression (a path, literal or sub-expression) and everything inside it. */
function checkExpression(node: hbs.AST.Node | null | undefined): void {
  if (!node) return;
  switch (node.type) {
    case "PathExpression": {
      // The first part is what Handlebars resolves a helper by, also for
      // `@name` and `name.more`.
      const first = (node as hbs.AST.PathExpression).parts[0];
      if (typeof first === "string" && first.startsWith(RESERVED_PREFIX))
        refuse(UNCOUNTED_MESSAGE);
      return;
    }
    case "SubExpression":
      checkCall(node as hbs.AST.SubExpression);
      return;
    case "StringLiteral":
    case "NumberLiteral":
    case "BooleanLiteral":
    case "UndefinedLiteral":
    case "NullLiteral":
      return;
    default:
      refuse(UNCOUNTED_MESSAGE);
  }
}

/** Checks the head, arguments and hash of a mustache, block or sub-expression. */
function checkCall(node: CallNode): hbs.AST.PathExpression {
  const path = headPath(node);
  checkExpression(path);
  for (const param of node.params ?? []) checkExpression(param);
  for (const pair of node.hash?.pairs ?? []) checkExpression(pair.value);
  return path;
}

/**
 * Rewrites `{{expression}}` to `{{__documentOutput expression}}` (or the raw
 * variant for `{{{expression}}}`), so the printed value is counted the
 * moment it is produced. What the expression evaluates to is unchanged: a
 * call stays a call, a bare name that is a helper stays a call of it, and
 * anything else stays the same context, data or block-param lookup.
 */
function meterMustache(mustache: hbs.AST.MustacheStatement, scope: string[][]) {
  const path = checkCall(mustache);
  const name = path.parts[0];
  const hasArguments = mustache.params.length > 0 || Boolean(mustache.hash);
  const shadowed = scope.some((names) => names.includes(name ?? ""));
  const callsHelper =
    hasArguments || (isSimpleId(path) && !shadowed && isRegisteredHelper(name));
  const expression = callsHelper
    ? ({
        type: "SubExpression",
        path,
        params: mustache.params,
        hash: mustache.hash,
        loc: mustache.loc,
      } as hbs.AST.SubExpression)
    : path;
  mustache.path = helperPath(
    mustache.escaped ? OUTPUT_METER_HELPER : RAW_OUTPUT_METER_HELPER,
    mustache.loc,
  );
  mustache.params = [expression];
  mustache.hash = undefined as unknown as hbs.AST.Hash;
  // The helper returns exactly what is appended (escaped already, as a SafeString).
  mustache.escaped = false;
}

/**
 * A block may be opened by one of {@link DOCUMENT_TEMPLATE_BLOCK_HELPERS} or
 * be a section on a context value. Handlebars resolves a helper by the first
 * part of the head whatever follows it (`{{#lookup.x a b}}` and
 * `{{#@lookup a b}}` both call `lookup`), so the rule is on that first part.
 */
function checkBlockHead(block: hbs.AST.BlockStatement) {
  const name = checkCall(block).parts[0];
  if (
    isRegisteredHelper(name) &&
    !(DOCUMENT_TEMPLATE_BLOCK_HELPERS as readonly string[]).includes(name ?? "")
  )
    refuse(
      `"${name}" cannot open a block. Blocks are each, if, unless and with; write {{${name} …}} to print a value.`,
    );
}

/**
 * Prepares one block body (or the template itself): checks and rewrites each
 * statement, then inserts the statement that counts the body's static text
 * and its steps (one, plus one per expression or block in it) on every run. Returns nothing; the AST is changed in place.
 */
function prepareProgram(
  program: hbs.AST.Program | null | undefined,
  scope: string[][],
): void {
  if (!program) return;
  scope.push(program.blockParams ?? []);
  let staticChars = 0;
  let statements = 0;
  for (const statement of program.body) {
    if (statement.type === "MustacheStatement" || statement.type === "BlockStatement")
      statements += 1;
    switch (statement.type) {
      case "ContentStatement": {
        const value = (statement as hbs.AST.ContentStatement).value;
        if (typeof value !== "string") refuse(UNCOUNTED_MESSAGE);
        staticChars += value.length;
        break;
      }
      case "CommentStatement":
        break;
      case "MustacheStatement":
        meterMustache(statement as hbs.AST.MustacheStatement, scope);
        break;
      case "BlockStatement": {
        const block = statement as hbs.AST.BlockStatement;
        checkBlockHead(block);
        prepareProgram(block.program, scope);
        prepareProgram(block.inverse, scope);
        break;
      }
      case "PartialStatement":
      case "PartialBlockStatement":
      case "Decorator":
      case "DecoratorBlock":
        refuse(PARTIAL_MESSAGE);
      // eslint-disable-next-line no-fallthrough
      default:
        refuse(UNCOUNTED_MESSAGE);
    }
  }
  scope.pop();
  program.body.unshift({
    type: "MustacheStatement",
    path: helperPath(RUN_METER_HELPER, program.loc),
    params: [
      {
        type: "NumberLiteral",
        value: staticChars,
        original: staticChars,
        loc: program.loc,
      } as hbs.AST.NumberLiteral,
      {
        type: "NumberLiteral",
        value: statements,
        original: statements,
        loc: program.loc,
      } as hbs.AST.NumberLiteral,
    ],
    hash: undefined as unknown as hbs.AST.Hash,
    escaped: false,
    strip: { open: false, close: false },
    loc: program.loc,
  } as hbs.AST.MustacheStatement);
}

type CompiledTemplate = (context: object) => string;

/**
 * Parses a template, applies the parse-time rules and the accounting
 * rewrite of {@link RenderMeter}, and compiles it.
 *
 * The compiler classes are called directly instead of
 * `handlebars.compile(ast)`: `compile` runs Handlebars' whitespace control a
 * second time over an AST it is given, and that pass must see the template
 * as written, not with the accounting statements in it (`handlebars.parse`
 * has already applied it once).
 */
function prepareTemplate(content: string): CompiledTemplate {
  const program = handlebars.parse(content);
  prepareProgram(program, []);
  const compiler = handlebars as unknown as {
    Compiler: new () => { compile(program: hbs.AST.Program, options: object): unknown };
    JavaScriptCompiler: new () => {
      compile(environment: unknown, options: object, context: undefined, asObject: true): TemplateSpecification;
    };
  };
  // The defaults `handlebars.compile` applies.
  const options = { data: true };
  const environment = new compiler.Compiler().compile(program, options);
  const specification = new compiler.JavaScriptCompiler().compile(
    environment,
    options,
    undefined,
    true,
  );
  return handlebars.template(specification) as CompiledTemplate;
}

/**
 * Runs one compiled template under the active meter and holds it to the
 * accounting: the string it returns must be exactly as long as what was
 * counted while it was built. Output that was produced without being
 * counted is refused, whatever produced it.
 */
function runMetered(template: CompiledTemplate, context: object): string {
  const current = meter();
  const before = current.chars;
  const raw = template(context);
  if (raw.length > current.chars - before) refuse(UNCOUNTED_MESSAGE);
  return raw;
}

/**
 * Compiles `content` once and renders it for every context under one shared
 * budget. Errors that are not already BAD_REQUEST (a parse error, an unknown
 * helper, a helper given the wrong arguments) become the generic one.
 */
function renderMetered(
  content: string,
  contexts: object[],
  limit: number,
): { raws: string[]; meter: RenderMeter } {
  if (activeMeter)
    throw new Error("A document render started inside another render.");
  const current: RenderMeter = { chars: 0, steps: 0, limit };
  try {
    const template = prepareTemplate(content);
    activeMeter = current;
    return {
      raws: contexts.map((context) => runMetered(template, context)),
      meter: current,
    };
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
 * instance (allowlisted helpers only, no partials) and returns sanitized,
 * CSP-wrapped HTML. The render is held to `maxOutputChars` **while it
 * runs** (see {@link RenderMeter}); invalid syntax, an unknown helper, a
 * refused construct and an oversized result are all BAD_REQUEST.
 */
export function renderDocument(
  content: string,
  context: object,
  options: { maxOutputChars?: number } = {},
) {
  return renderDocuments(content, [context], options)[0]!;
}

/**
 * Renders one template for each context of a batch (one per student, bill
 * or receipt), compiled once. The whole batch shares **one** budget, so the
 * cost of a batch is bounded by the same ceiling as its combined result
 * ({@link combineDocuments}), not by the ceiling times the batch size.
 */
export function renderDocuments(
  content: string,
  contexts: object[],
  options: { maxOutputChars?: number } = {},
): string[] {
  const { raws } = renderMetered(
    content,
    contexts,
    options.maxOutputChars ?? DOCUMENT_RENDER_MAX_CHARS,
  );
  return raws.map(safeHtml);
}

/**
 * The unsanitized output of one render with what the meter counted for it:
 * for tests of the accounting (`chars` must equal `raw.length`).
 */
export function measureDocumentRender(
  content: string,
  context: object,
  maxOutputChars: number = DOCUMENT_RENDER_MAX_CHARS,
) {
  const { raws, meter: used } = renderMetered(content, [context], maxOutputChars);
  return { raw: raws[0]!, chars: used.chars, steps: used.steps };
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
