import Handlebars from "handlebars";
import sanitizeHtml from "sanitize-html";
import { DOCUMENT_SANITIZER_OPTIONS, EMBEDDABLE_IMAGE } from "./document.sanitize";
import { env } from "@campuspilot/env/server";
import { rpcError } from "../../../errors";
import { ORPCError } from "@orpc/server";
import { QUESTION_PAPER_LIMITS } from "@campuspilot/question-paper/limits";
import { PDFDocument } from "pdf-lib";
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
 * Structural limits on a template, checked when it is parsed: block nesting
 * and sub-expression depth on the tokens **before** Handlebars builds its
 * tree ({@link parseDocumentTemplate}), the rest on the tree
 * ({@link checkCall}). Together with the per-run charge in
 * {@link prepareProgram} they make the budget bound CPU, not only output:
 * Handlebars evaluates every argument, hash pair and path part of a
 * statement on every run, so the work of one run must be a small, counted
 * multiple of one step. A statement such as `{{lookup a a … a}}` with
 * 60,000 arguments, or 30,000 hash pairs, would otherwise cost tens of
 * thousands of evaluations per run while being charged as one.
 *
 * The limits are far above what any catalog design or the notice starter
 * uses (at most 2 arguments, no hash, 3 path parts, sub-expressions one
 * level deep, 5 nodes in one statement, 111 in a whole template and blocks
 * 5 levels deep; `document.render.test.ts` pins this for every marketplace
 * design).
 *
 * Nesting is limited before parsing because Handlebars' parser itself is
 * superlinear in it: 4,000 nested sub-expressions (32 KB) take 2.6 s to
 * parse and 25,000 (200 KB, the template size limit) would take minutes;
 * 4,000 nested blocks take 2 s, and a long `{{else if}}` chain nests the
 * same way. The lexer that finds the tokens is linear, and the check reads
 * every token of the template, past raw blocks, comments and strings (see
 * {@link checkTemplateNesting} for the only early stops).
 */
export const DOCUMENT_TEMPLATE_STRUCTURE_LIMITS = {
  /** Positional arguments of one call (`each`, `if`, `lookup`, `add` take one or two). */
  params: 4,
  /** Named (hash) arguments of one call (`{{#if x includeZero=true}}`). */
  hashPairs: 4,
  /** Parts of one path (`student.guardian.name` has three). */
  pathParts: 8,
  /** How deeply sub-expressions may nest (`(add (add a 1) 2)` is two deep). */
  subExpressionDepth: 4,
  /** Expression nodes in one statement: path parts, literals and sub-expression heads. */
  statementNodes: 32,
  /** Expression nodes in the whole template. */
  templateNodes: 10_000,
  /**
   * How deeply blocks may nest, counting every `{{else if}}` (or other
   * `{{else x}}`) of a chain as one level, because Handlebars nests each
   * branch of a chain inside the previous one.
   */
  blockNesting: 64,
} as const;
const EXPRESSION_LIMIT_MESSAGES = {
  params: `A template expression can take at most ${DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.params} arguments.`,
  hashPairs: `A template expression can take at most ${DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.hashPairs} named arguments.`,
  pathParts: `A template value can have at most ${DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.pathParts} parts (such as student.guardian.name).`,
  subExpressionDepth: `Template sub-expressions such as (lookup a b) can nest at most ${DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.subExpressionDepth} levels deep.`,
  statementNodes: `A template expression is too complex. Split it into simpler ones.`,
  templateNodes: `This template has too many expressions (at most ${DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.templateNodes.toLocaleString("en-IN")}).`,
  blockNesting: `Blocks such as each and if, counting every else-if branch, can nest at most ${DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.blockNesting} levels deep.`,
} as const;
const SYNTAX_MESSAGE =
  "The template contains invalid Handlebars syntax or an unsupported helper.";

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
 * | `{{#each}}`, `{{#if}}`, `{{#unless}}`, `{{#with}}`, `{{else}}`, `{{else if}}`, `{{^}}` | output is the bodies they run: each run counts itself; every run also costs one step plus, for every statement in the body, its expression nodes (path parts, literals, sub-expression heads; at least one), so loops that print nothing are bounded too |
 * | Expressions with many arguments, hash pairs, path parts or nested sub-expressions | refused at parse time beyond {@link DOCUMENT_TEMPLATE_STRUCTURE_LIMITS} |
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
   * of the template) plus, for every expression or block written in that
   * body, the number of expression nodes Handlebars evaluates for it. Every
   * node is a bounded amount of work (the limits of
   * {@link DOCUMENT_TEMPLATE_STRUCTURE_LIMITS} hold each statement to a
   * few), so loops that print nothing still end, in time proportional to
   * the budget.
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
 * One run of a body: its static text, and as steps one for the run plus the
 * expression nodes of the statements written directly in it. Charging the
 * expressions makes the work of a run (not only its output) count: a body
 * of thousands of `{{missing}}` inside nested loops prints nothing, yet each
 * run evaluates every one of them, and `{{lookup a b}}` evaluates three
 * nodes where `{{a}}` evaluates one.
 */
handlebars.registerHelper(
  RUN_METER_HELPER,
  (staticChars: unknown, expressionNodes: unknown) => {
    spend(
      typeof staticChars === "number" ? staticChars : 0,
      1 + (typeof expressionNodes === "number" ? expressionNodes : 0),
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

/**
 * Checks one expression (a path, literal or sub-expression) and everything
 * inside it, and returns its expression nodes: the parts of a path (at least
 * one, for `this`), one per literal, and the nodes of a sub-expression's
 * head, arguments and hash. `depth` is how many sub-expressions enclose it.
 */
function checkExpression(
  node: hbs.AST.Node | null | undefined,
  depth: number,
): number {
  if (!node) return 0;
  switch (node.type) {
    case "PathExpression": {
      const parts = (node as hbs.AST.PathExpression).parts;
      // The first part is what Handlebars resolves a helper by, also for
      // `@name` and `name.more`.
      const first = parts[0];
      if (typeof first === "string" && first.startsWith(RESERVED_PREFIX))
        refuse(UNCOUNTED_MESSAGE);
      if (parts.length > DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.pathParts)
        refuse(EXPRESSION_LIMIT_MESSAGES.pathParts);
      return Math.max(1, parts.length);
    }
    case "SubExpression":
      if (depth + 1 > DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.subExpressionDepth)
        refuse(EXPRESSION_LIMIT_MESSAGES.subExpressionDepth);
      return checkCall(node as hbs.AST.SubExpression, depth + 1).nodes;
    case "StringLiteral":
    case "NumberLiteral":
    case "BooleanLiteral":
    case "UndefinedLiteral":
    case "NullLiteral":
      return 1;
    default:
      refuse(UNCOUNTED_MESSAGE);
  }
}

/**
 * Checks the head, arguments and hash of a mustache, block or sub-expression
 * against the rules above and {@link DOCUMENT_TEMPLATE_STRUCTURE_LIMITS},
 * and returns its head path and expression nodes (what one evaluation of it
 * costs, in steps). The argument and pair counts are checked before any of
 * them is walked, so an oversized call is refused without visiting it.
 */
function checkCall(
  node: CallNode,
  depth = 0,
): { path: hbs.AST.PathExpression; nodes: number } {
  const params = node.params ?? [];
  const pairs = node.hash?.pairs ?? [];
  if (params.length > DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.params)
    refuse(EXPRESSION_LIMIT_MESSAGES.params);
  if (pairs.length > DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.hashPairs)
    refuse(EXPRESSION_LIMIT_MESSAGES.hashPairs);
  const path = headPath(node);
  let nodes = checkExpression(path, depth);
  for (const param of params) nodes += checkExpression(param, depth);
  for (const pair of pairs) nodes += checkExpression(pair.value, depth);
  if (nodes > DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.statementNodes)
    refuse(EXPRESSION_LIMIT_MESSAGES.statementNodes);
  return { path, nodes };
}

/**
 * Rewrites `{{expression}}` to `{{__documentOutput expression}}` (or the raw
 * variant for `{{{expression}}}`), so the printed value is counted the
 * moment it is produced. What the expression evaluates to is unchanged: a
 * call stays a call, a bare name that is a helper stays a call of it, and
 * anything else stays the same context, data or block-param lookup.
 */
function meterMustache(
  mustache: hbs.AST.MustacheStatement,
  scope: string[][],
): number {
  const { path, nodes } = checkCall(mustache);
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
  return nodes;
}

/**
 * A block may be opened by one of {@link DOCUMENT_TEMPLATE_BLOCK_HELPERS} or
 * be a section on a context value. Handlebars resolves a helper by the first
 * part of the head whatever follows it (`{{#lookup.x a b}}` and
 * `{{#@lookup a b}}` both call `lookup`), so the rule is on that first part.
 */
function checkBlockHead(block: hbs.AST.BlockStatement): number {
  const { path, nodes } = checkCall(block);
  const name = path.parts[0];
  if (
    isRegisteredHelper(name) &&
    !(DOCUMENT_TEMPLATE_BLOCK_HELPERS as readonly string[]).includes(name ?? "")
  )
    refuse(
      `"${name}" cannot open a block. Blocks are each, if, unless and with; write {{${name} …}} to print a value.`,
    );
  return nodes;
}

/** What {@link prepareProgram} carries through one template. */
type PrepareState = {
  /** The block params in scope, innermost last. */
  scope: string[][];
  /** Expression nodes seen so far in the whole template. */
  templateNodes: number;
};

/**
 * Prepares one block body (or the template itself): checks and rewrites each
 * statement, then inserts the statement that counts the body's static text
 * and its steps (one, plus the expression nodes of every expression or block
 * in it) on every run. Returns nothing; the AST is changed in place.
 */
function prepareProgram(
  program: hbs.AST.Program | null | undefined,
  state: PrepareState,
): void {
  if (!program) return;
  const { scope } = state;
  scope.push(program.blockParams ?? []);
  let staticChars = 0;
  let expressionNodes = 0;
  const charge = (nodes: number) => {
    expressionNodes += nodes;
    state.templateNodes += nodes;
    if (state.templateNodes > DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.templateNodes)
      refuse(EXPRESSION_LIMIT_MESSAGES.templateNodes);
  };
  for (const statement of program.body) {
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
        charge(meterMustache(statement as hbs.AST.MustacheStatement, scope));
        break;
      case "BlockStatement": {
        const block = statement as hbs.AST.BlockStatement;
        charge(checkBlockHead(block));
        prepareProgram(block.program, state);
        prepareProgram(block.inverse, state);
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
        value: expressionNodes,
        original: expressionNodes,
        loc: program.loc,
      } as hbs.AST.NumberLiteral,
    ],
    hash: undefined as unknown as hbs.AST.Hash,
    escaped: false,
    strip: { open: false, close: false },
    loc: program.loc,
  } as hbs.AST.MustacheStatement);
}

type TemplateLexer = {
  EOF: number;
  setInput(input: string, yy: object): void;
  lex(): number | string;
};
const templateParser = (
  handlebars as unknown as {
    Parser: {
      lexer: TemplateLexer;
      terminals_: Record<number, string>;
      symbols_: Record<string, number>;
    };
  }
).Parser;
/** Token ids of Handlebars' grammar by name. */
const TOKEN = Object.fromEntries(
  Object.entries(templateParser.terminals_).map(([id, name]) => [name, Number(id)]),
) as Record<string, number>;
/** Every token id of the grammar: a lexer result that maps to none of these cannot be classified. */
const TERMINAL_IDS = new Set(Object.values(TOKEN));
/** Tokens that open a block whose end is an `{{/…}}` (or a raw block's end). */
const BLOCK_OPENERS = new Set(
  ["OPEN_BLOCK", "OPEN_INVERSE", "OPEN_RAW_BLOCK", "OPEN_PARTIAL_BLOCK"].map(
    (name) => TOKEN[name],
  ),
);
const BLOCK_CLOSERS = new Set(
  ["OPEN_ENDBLOCK", "END_RAW_BLOCK"].map((name) => TOKEN[name]),
);

/**
 * What one lexer result is to the scan: a grammar token id, the end of the
 * input, or a point where the parser is certain to stop with a syntax error.
 *
 * The generated lexer returns numeric ids for every rule except two, which
 * return the token **name**: `END_RAW_BLOCK` (`{{{{/raw}}}}`) and `INVALID`.
 * The parser maps names through its symbol table (`symbols_`), and so does
 * this: `END_RAW_BLOCK` becomes its id and closes the raw block. `INVALID` is
 * not a grammar symbol, so the parser reports a syntax error at it, having
 * consumed only tokens before it, all of them already scanned.
 *
 * Anything else that is not a grammar token is `null`: the scan cannot
 * classify it and the template is refused, instead of being handed to the
 * parser with input the scan never looked at.
 */
function classifyToken(token: number | string, lexer: TemplateLexer): number | "end" | "parser-error" | null {
  if (token === lexer.EOF || token === TOKEN.EOF) return "end";
  if (token === "INVALID") return "parser-error";
  const id = typeof token === "number" ? token : templateParser.symbols_[token];
  return id !== undefined && TERMINAL_IDS.has(id) ? id : null;
}

/**
 * Checks block nesting and sub-expression depth on the template's tokens,
 * in one linear pass of Handlebars' own lexer, before the parser (which is
 * superlinear in nesting, see {@link DOCUMENT_TEMPLATE_STRUCTURE_LIMITS})
 * sees it.
 *
 * The scan reads the whole template. It stops early only where the parser
 * is certain to fail at the same point (an `INVALID` token, or a lexical
 * error, which the parser's own copy of the lexer raises at the same
 * position because it lexes lazily, one token ahead), so the parser never
 * consumes a token the scan has not checked. A token the scan cannot
 * classify, or a scan that does not finish, refuses the template.
 *
 * Unbalanced input is not judged here: the scan only ever refuses too much
 * depth (or what it cannot classify), and the parser reports syntax errors.
 */
function checkTemplateNesting(content: string) {
  const lexer = Object.create(templateParser.lexer) as TemplateLexer;
  lexer.setInput(content, {});
  /** Levels of each open block: one for the block plus one per `{{else x}}` branch. */
  const blocks: number[] = [];
  let blockDepth = 0;
  let subExpressionDepth = 0;
  // Every token but EOF consumes input; the cap only guards that assumption.
  for (let guard = 2 * content.length + 16; guard > 0; guard -= 1) {
    let token: number | string;
    try {
      token = lexer.lex();
    } catch {
      // A lexical error: the parser stops with it at this same position.
      return;
    }
    const id = classifyToken(token, lexer);
    if (id === "end" || id === "parser-error") return;
    if (id === null) refuse(UNCOUNTED_MESSAGE);
    if (BLOCK_OPENERS.has(id)) {
      blocks.push(1);
      blockDepth += 1;
    } else if (id === TOKEN.OPEN_INVERSE_CHAIN && blocks.length > 0) {
      blocks[blocks.length - 1]! += 1;
      blockDepth += 1;
    } else if (BLOCK_CLOSERS.has(id)) {
      blockDepth -= blocks.pop() ?? 0;
    } else if (id === TOKEN.OPEN_SEXPR) {
      subExpressionDepth += 1;
      if (subExpressionDepth > DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.subExpressionDepth)
        refuse(EXPRESSION_LIMIT_MESSAGES.subExpressionDepth);
    } else if (id === TOKEN.CLOSE_SEXPR) {
      subExpressionDepth = Math.max(0, subExpressionDepth - 1);
    }
    if (blockDepth > DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.blockNesting)
      refuse(EXPRESSION_LIMIT_MESSAGES.blockNesting);
  }
  refuse(UNCOUNTED_MESSAGE);
}

/**
 * Parses a template with the restricted instance after the nesting check
 * that keeps parsing linear ({@link checkTemplateNesting}). Every server
 * parse of a template goes through here, including the notice editor's
 * structural check, so no caller can hand the parser deep nesting.
 * Invalid syntax is a BAD_REQUEST.
 */
export function parseDocumentTemplate(content: string): hbs.AST.Program {
  checkTemplateNesting(content);
  try {
    return handlebars.parse(content);
  } catch (cause) {
    const line = syntaxErrorLine(cause);
    throw rpcError.badRequest(
      line === null ? SYNTAX_MESSAGE : `The template has invalid Handlebars syntax on line ${line}.`,
      cause,
    );
  }
}

/**
 * The line a Handlebars parse error points at, or null: the parser's own
 * errors say "Parse error on line N:", block mismatches carry `lineNumber`.
 * Only the number is passed on, never the parser's excerpt of the source.
 */
function syntaxErrorLine(cause: unknown): number | null {
  if (!(cause instanceof Error)) return null;
  const { lineNumber } = cause as Error & { lineNumber?: unknown };
  if (typeof lineNumber === "number" && Number.isInteger(lineNumber) && lineNumber > 0) return lineNumber;
  const match = /^Parse error on line (\d+):/.exec(cause.message);
  return match ? Number(match[1]) : null;
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
  const program = parseDocumentTemplate(content);
  prepareProgram(program, { scope: [], templateNodes: 0 });
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
    throw rpcError.badRequest(SYNTAX_MESSAGE, cause);
  } finally {
    activeMeter = null;
  }
}
const policy =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
/**
 * The Content-Security-Policy of a document of `type`. Every type gets the
 * same policy except `question_paper`, which adds `font-src data:` so the
 * KaTeX fonts, inlined as data URIs in the question paper body, can load.
 * That is the only widening: no network, no script, no frames, images still
 * from data URIs only. See the SECURITY note on `QUESTION_PAPER_SLOT`
 * (design.md K1): this is a deliberate, narrow, single-type exception and
 * must not become a general way to relax the policy for a template design.
 */
export function documentContentSecurityPolicy(type?: DocumentType) {
  return type === "question_paper" ? `${policy}; font-src data:` : policy;
}
/** The CSP is inserted before all user markup. Sanitization removes active
 * elements and attributes; data-only images keep previews and Chromium offline.
 * Handlebars' own-property lookup protections remain enabled.
 */
function safeHtml(raw: string, type?: DocumentType) {
  if (Buffer.byteLength(raw, "utf8") > 25_000_000)
    throw rpcError.badRequest(
      "This document exceeds the 25 MB rendering limit. Select fewer students or use smaller photos.",
    );
  const clean = sanitizeHtml(raw, {
    ...DOCUMENT_SANITIZER_OPTIONS,
    allowedTags: (DOCUMENT_SANITIZER_OPTIONS.allowedTags as string[]).filter(
      (tag) => !["html", "head", "body"].includes(tag),
    ),
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${documentContentSecurityPolicy(type)}"></head><body>${clean}</body></html>`;
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
  return raws.map((raw) => safeHtml(raw));
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

/** Margin of every physical page of a full-A4 flowing notice. */
const NOTICE_PAGE_MARGIN = "16mm";
/**
 * Margin of every half-A4 page of a half-page notice: smaller than the
 * full-page margin so a half page keeps a useful text area, and wide
 * enough that the cut guide between the two copies on a sheet
 * (`imposeHalfPageNoticeCopies`) falls in blank paper.
 */
const HALF_NOTICE_PAGE_MARGIN = "10mm";
/** Height of the text area of one half-A4 notice page: 148.5 mm less both margins. */
const HALF_NOTICE_TEXT_HEIGHT = "128.5mm";

/**
 * Notices flow: their length is whatever the author wrote, so they are not
 * clipped to one fixed sheet like every other document, and nothing is
 * ever hidden. Each notice starts on a new page and continues over as many
 * pages as it needs. The page margin belongs to `@page`, so every
 * continuation page keeps it (padding on the template's root would apply
 * to the first and last page only).
 *
 * - `full`: portrait A4 pages with a 16 mm margin.
 * - `half`: pages of half an A4 sheet (210 x 148.5 mm) with a 10 mm margin;
 *   a long notice continues on the next half page. Chromium paginates the
 *   text; the PDF is then imposed two copies per A4 sheet
 *   (`imposeHalfPageNoticeCopies` in the notice renderer), so it prints on
 *   ordinary A4 paper.
 *
 * On screen (the sandboxed preview, where `@page` does not apply) the same
 * margin is shown as padding around an A4-wide column, so the text wraps at
 * the printed width. A half-page notice additionally shows a line at every
 * 128.5 mm of text, where each half page ends, and a caption in its top
 * margin: the preview cannot paginate, so the lines mark the frame (a page
 * may break a line or two earlier, never later: Chromium does not split a
 * line of text across pages).
 */
function flowingNoticeLayout(documents: string[], pageSize: DocumentTemplatePageSize) {
  const notices = documents
    .map((doc) => `<article class="notice-document">${doc}</article>`)
    .join("");
  const half = pageSize === "half";
  const margin = half ? HALF_NOTICE_PAGE_MARGIN : NOTICE_PAGE_MARGIN;
  const page = half ? `size:210mm 148.5mm;margin:${margin}` : `size:A4;margin:${margin}`;
  const halfFrame = half
    ? `.notice-document{position:relative;background-image:linear-gradient(to bottom,transparent calc(100% - 0.4mm),#9aa5b1 calc(100% - 0.4mm));background-size:100% ${HALF_NOTICE_TEXT_HEIGHT};background-origin:content-box;background-clip:content-box;background-repeat:repeat-y}.notice-document::before{content:"Half A4 \\00b7  two copies per A4 sheet \\00b7  lines mark where each half page ends";position:absolute;top:3mm;right:${margin};font:9px/1 Arial,Helvetica,sans-serif;color:#7b8794}`
    : "";
  return `<div class="batch">${notices}</div><style>@page{${page}}html,body{margin:0!important;padding:0!important}.notice-document{box-sizing:border-box;width:100%;break-after:page;overflow-wrap:anywhere}.notice-document:last-child{break-after:auto}@media screen{.notice-document{max-width:210mm;margin:0 auto;padding:${margin}}${halfFrame}}</style>`;
}

/** Margins of every physical page of a question paper. The footer is NOT in the bottom margin, see below. */
const QUESTION_PAPER_PAGE_MARGIN = "14mm 14mm 10mm";
/**
 * Height of the band at the bottom of every page that flowing content never
 * enters: the room for the template's `position: fixed; bottom: 0` footer.
 * A footer must be shorter than this (the context help says 12mm).
 */
const QUESTION_PAPER_FOOTER_BAND = "14mm";

/**
 * Question papers flow over as many full A4 pages as their questions need
 * (the length is the AI's or the teacher's, not the template's), so like
 * notices they are never clipped to one sheet. `@page` owns the margin so
 * every continuation page keeps it. The school's template draws the heading
 * in normal flow on the first page and the footer as a `position: fixed;
 * bottom: 0` element that Chromium repeats on every printed page.
 *
 * Why the table: verified against the Gotenberg/Chromium of the stack
 * (design.md I5.1), a fixed element can only be painted inside the page's
 * content area. Anything placed in the margin (negative `bottom`, a
 * transform, `top: 100%`) is dropped from page 1 and re-appears at the top of
 * the following pages. A fixed footer at `bottom: 0` is repeated correctly
 * but would be painted over the last lines of every page. A
 * `table-footer-group` is repeated by Chromium on every page and takes its
 * height out of the flowing area, so the wrapper reserves the footer band at
 * the bottom of every page and the fixed footer sits in that band.
 *
 * On screen (the sandboxed preview, where `@page` does not apply) the same
 * margin is shown as padding around an A4-wide column. There the paper is one
 * long column, not pages, so a footer fixed to the viewport would float over
 * whichever questions happen to be at the bottom of the frame. The frame
 * (the page's content area, inside the padding) therefore gets a
 * `transform`, which makes it the containing block of its fixed descendants:
 * the footer sits once at the end of the paper, in the footer band and within
 * the margins as in print, and scrolls with it. Print is untouched
 * (`@media screen`).
 */
function flowingQuestionPaperLayout(documents: string[]) {
  const papers = documents
    .map(
      (doc) =>
        `<article class="question-paper-document"><table class="qp-frame"><tbody><tr><td>${doc}</td></tr></tbody><tfoot><tr><td><div class="qp-footer-band"></div></td></tr></tfoot></table></article>`,
    )
    .join("");
  return `<div class="batch">${papers}</div><style>@page{size:A4;margin:${QUESTION_PAPER_PAGE_MARGIN}}html,body{margin:0!important;padding:0!important}.question-paper-document{box-sizing:border-box;width:100%;overflow-wrap:anywhere}.qp-frame{width:100%;border-collapse:collapse;border-spacing:0}.qp-frame>tbody>tr>td,.qp-frame>tfoot>tr>td{padding:0;border:0;vertical-align:top}.qp-footer-band{height:${QUESTION_PAPER_FOOTER_BAND}}@media screen{.question-paper-document{max-width:210mm;margin:0 auto;padding:${QUESTION_PAPER_PAGE_MARGIN}}.qp-frame{transform:translate(0)}}</style>`;
}

/** Templates own the design inside one slot; this wrapper exclusively owns
 * physical A4 imposition. Half templates are paired vertically, ID cards are
 * placed eight-up, and every other document gets one physical sheet, except
 * notices, which flow over as many full- or half-A4 pages as they need
 * ({@link flowingNoticeLayout}), and question papers, which flow over full
 * A4 pages ({@link flowingQuestionPaperLayout}).
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
  if (type === "notice") return safeHtml(flowingNoticeLayout(documents, pageSize));
  if (type === "question_paper")
    return safeHtml(flowingQuestionPaperLayout(documents), type);
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
/** How long the converter may work on one question paper (the other documents get 120 seconds). */
const QUESTION_PAPER_CONVERSION_TIMEOUT_MS = 60_000;

/**
 * Question papers are untrusted markup in the end (a model wrote them): the
 * converter prints at most {@link QUESTION_PAPER_LIMITS.pdfPages} pages and
 * stops after {@link QUESTION_PAPER_CONVERSION_TIMEOUT_MS}. The page range
 * asks for ONE page more than the cap, so a paper over the cap is detected
 * (and refused with a clear message) instead of being silently cut.
 */
async function assertQuestionPaperPageCount(bytes: Buffer) {
  const pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  if (pages > QUESTION_PAPER_LIMITS.pdfPages) {
    throw rpcError.badRequest(
      `This paper would print on more than ${QUESTION_PAPER_LIMITS.pdfPages} pages, which is the limit. Shorten it or reduce font sizes, spacing and heights.`,
    );
  }
}

export async function convertDocumentPdf(
  html: string,
  type: DocumentType,
  signal?: AbortSignal,
) {
  const questionPaper = type === "question_paper";
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("paperWidth", type === "timetable" ? "11.7" : "8.27");
  form.append("paperHeight", type === "timetable" ? "8.27" : "11.7");
  form.append("preferCssPageSize", "true");
  form.append("printBackground", "true");
  if (questionPaper) form.append("nativePageRanges", `1-${QUESTION_PAPER_LIMITS.pdfPages + 1}`);
  const response = await fetch(
    `${env.GOTENBERG_URL.replace(/\/$/, "")}/forms/chromium/convert/html`,
    {
      method: "POST",
      body: form,
      signal: AbortSignal.any([
        AbortSignal.timeout(questionPaper ? QUESTION_PAPER_CONVERSION_TIMEOUT_MS : 120_000),
        ...(signal ? [signal] : []),
      ]),
    },
  );
  if (!response.ok)
    throw new Error(`PDF conversion failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 30_000_000 || bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new Error("PDF converter returned an invalid or oversized document.");
  if (questionPaper) await assertQuestionPaperPageCount(bytes);
  return bytes;
}
