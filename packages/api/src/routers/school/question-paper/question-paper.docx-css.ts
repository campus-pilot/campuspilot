import { compile as compileSelector, type Options } from 'css-select';
import { parse as parseSelector, type Selector } from 'css-what';
import { defaultTreeAdapter as tree, type DefaultTreeAdapterMap } from 'parse5';
import { parse as parseCss, type AtRule, type ChildNode, type Container } from 'postcss';

/**
 * The CSS cascade the Word (.docx) conversion reads (`question-paper.docx-html.ts`).
 *
 * Pandoc ignores CSS, so the layout a paper depends on (a flex row of number,
 * question and marks, a grid of options, a bordered box, a centred heading) has
 * to be read from the style sheets and turned into plain structure first. This
 * file answers one question per element: which declarations apply to it, in
 * cascade order (specificity, then source order; inline `style=""` after the
 * sheets; `!important` after both).
 *
 * Selectors are matched by a real selector engine (`css-select`, over the parse5
 * tree the sanitiser itself proves the fragment against, through
 * {@link budgetedParse5Adapter}), never by a hand-written matcher. The values are only
 * READ by our own code (a border is there or not, a width in millimetres); no
 * authored CSS is ever written into the Word file.
 *
 * Bounded work: a sheet holds at most {@link MAX_SELECTORS} selectors (the rest is
 * ignored), rules are bucketed by the class or tag of their rightmost compound so
 * an element only meets the rules that could match it, and every step of the
 * work is paid from ONE budget per conversion ({@link DocxWorkBudget}). The
 * selector engine is charged inside its tree adapter: every parent, sibling,
 * child or attribute it looks at costs one unit, so a selector whose matching
 * explodes (a chain of `~` combinators backtracks exponentially, `:has()` walks
 * the subtree for each element) runs out of budget in a bounded time instead of
 * blocking the event loop. A document over the budget is refused
 * ({@link DocxTooComplexError}), never converted slowly.
 */

export type Node = DefaultTreeAdapterMap['node'];
export type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];
/** css-select's adapter interface (not exported by name). */
type Adapter<N, E extends N> = NonNullable<Options<N, E>['adapter']>;

/** Selectors one style sheet may contribute; a model's sheet is at most 30,000 characters, so this is never reached by a real paper. */
const MAX_SELECTORS = 5_000;
/** Selector matcher calls one cascade may make before the document is refused as too complex to convert. */
/** Declarations a single `style=""` attribute may contribute. */
const MAX_INLINE_DECLARATIONS = 200;

const childNodesOf = (node: Node): Node[] => ('childNodes' in node ? (node.childNodes as Node[]) : []);
const parentOf = (node: Node): ParentNode | null => ('parentNode' in node ? (node.parentNode ?? null) : null);

/** A conversion ran out of its work budget: the document is too complex to convert to Word. */
export class DocxTooComplexError extends Error {
  constructor() {
    super('This paper is too complex to convert to Word.');
  }
}

/**
 * The work one Word conversion may do, in units of one tree step (a node visited,
 * a parent or sibling looked up, a selector tried on an element). Shared by the
 * cascades of the template and of the body and by the converter's own walks, so
 * no part of a conversion can spend more than the whole. Each unit is a constant
 * amount of work, so the budget bounds the conversion's time on its own (no
 * worker thread is needed to stop it): {@link DOCX_WORK_BUDGET} units take about
 * a quarter of a second at worst (measured with selectors built to explode).
 */
export class DocxWorkBudget {
  private used = 0;
  constructor(private readonly limit: number) {}

  spend(units = 1): void {
    this.used += units;
    if (this.used > this.limit) throw new DocxTooComplexError();
  }

  /** The units spent so far (logged with the conversion, `docxWorkUnits`). */
  get spent(): number {
    return this.used;
  }
}

/** The units of one conversion. A real paper with its template uses well under a tenth of it. */
export const DOCX_WORK_BUDGET = 4_000_000;

/** The text of a node and its descendants, gathered without recursion (a tree can be deeper than the call stack), each node paid for. */
export function textOf(node: Node, budget: DocxWorkBudget): string {
  let text = '';
  const stack: Node[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    // A long text costs in proportion to its length (one unit per 64 characters), so reading text repeatedly is paid for too.
    if (tree.isTextNode(current)) {
      budget.spend(1 + (current.value.length >> 6));
      text += current.value;
      continue;
    }
    budget.spend();
    const children = childNodesOf(current);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]!);
  }
  return text;
}

export const attributeOf = (element: Element, name: string): string | undefined => element.attrs.find((attribute) => attribute.name === name)?.value;

/**
 * `css-select` over parse5's default tree (the tree the sanitiser compares its
 * output with, `question-paper.tree.ts`), every call paid from `budget` (see
 * the file note): the selector engine cannot do more work than the budget
 * allows, however its selectors backtrack.
 */
export function budgetedParse5Adapter(budget: DocxWorkBudget): Adapter<Node, Element> {
  return {
    isTag: (node): node is Element => {
      budget.spend();
      return tree.isElementNode(node);
    },
    getAttributeValue: (element, name) => {
      budget.spend();
      return attributeOf(element, name);
    },
    getChildren: (node) => {
      budget.spend();
      return childNodesOf(node);
    },
    getName: (element) => {
      budget.spend();
      return element.tagName;
    },
    getParent: (element) => {
      budget.spend();
      return parentOf(element) as Node | null;
    },
    getSiblings: (node) => {
      budget.spend();
      const parent = parentOf(node);
      return parent ? childNodesOf(parent as Node) : [node];
    },
    prevElementSibling: (node) => {
      budget.spend();
      const parent = parentOf(node);
      if (!parent) return null;
      const siblings = childNodesOf(parent as Node);
      for (let index = siblings.indexOf(node) - 1; index >= 0; index -= 1) {
        budget.spend();
        const sibling = siblings[index]!;
        if (tree.isElementNode(sibling)) return sibling;
      }
      return null;
    },
    getText: (node) => textOf(node, budget),
    hasAttrib: (element, name) => {
      budget.spend();
      return element.attrs.some((attribute) => attribute.name === name);
    },
    removeSubsets: (nodes) => {
      const set = new Set(nodes);
      return nodes.filter((node) => {
        for (let parent = parentOf(node); parent; parent = parentOf(parent as Node)) {
          budget.spend();
          if (set.has(parent as Node)) return false;
        }
        return true;
      });
    },
  };
}

type Specificity = readonly [number, number, number];

/** Specificity of one complex selector from its css-what tokens (`:is()`/`:not()`/`:has()` count their most specific argument, `:where()` nothing). */
function specificityOf(tokens: readonly Selector[]): Specificity {
  let a = 0;
  let b = 0;
  let c = 0;
  for (const token of tokens) {
    if (token.type === 'attribute') {
      if (token.name === 'id' && token.action === 'equals') a += 1;
      else b += 1;
    } else if (token.type === 'tag' || token.type === 'pseudo-element') c += 1;
    else if (token.type === 'pseudo') {
      if (token.name === 'where') continue;
      if (Array.isArray(token.data) && ['is', 'not', 'has', 'matches'].includes(token.name)) {
        const best = token.data.map(specificityOf).reduce<Specificity>((max, next) => (compareSpecificity(next, max) > 0 ? next : max), [0, 0, 0]);
        a += best[0];
        b += best[1];
        c += best[2];
      } else b += 1;
    }
  }
  return [a, b, c];
}

function compareSpecificity(x: Specificity, y: Specificity): number {
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** The bucket a rule is filed under: the first class of its rightmost compound, else its tag, else `*`. */
function bucketOf(tokens: readonly Selector[]): string {
  let tag: string | null = null;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (token.type === 'attribute' && token.name === 'class' && token.action === 'element') return `.${token.value}`;
    if (token.type === 'tag') tag = token.name;
    if (['descendant', 'child', 'sibling', 'adjacent', 'parent', 'column-combinator'].includes(token.type)) break;
  }
  return tag ?? '*';
}

type Declaration = { property: string; value: string; important: boolean };
type Rule = { matches: (element: Element) => boolean; specificity: Specificity; order: number; declarations: Declaration[] };

/** Whether a rule nested in these at-rules applies to print: only inside `@media` that names `print` or `all` and not `screen`. */
function appliesToPrint(node: ChildNode): boolean {
  for (let parent: Container | undefined = node.parent as Container | undefined; parent && parent.type !== 'root'; parent = parent.parent as Container | undefined) {
    if (parent.type !== 'atrule') return false;
    const atRule = parent as AtRule;
    if (atRule.name.toLowerCase() !== 'media') return false;
    const query = atRule.params.toLowerCase();
    if (/\bscreen\b/.test(query) || !/\b(?:print|all)\b/.test(query)) return false;
  }
  return true;
}

/** Declarations of a `style=""` attribute, in order. Values are only read by our code, never written out as CSS. */
export function inlineDeclarations(style: string): Declaration[] {
  const declarations: Declaration[] = [];
  try {
    const first = parseCss(`x{${style}}`).first;
    if (first?.type !== 'rule') return declarations;
    first.each((child) => {
      if (child.type === 'decl' && declarations.length < MAX_INLINE_DECLARATIONS) {
        declarations.push({ property: child.prop.toLowerCase(), value: child.value.trim(), important: child.important });
      }
    });
  } catch {
    // An attribute postcss cannot read contributes nothing.
  }
  return declarations;
}

/** The declarations that apply to one element, in the order they win (a later entry overrides an earlier one of the same property). */
export type ElementStyle = {
  /** The winning value of a property, as written (lowercased name). */
  get(property: string): string | undefined;
  /** Every applied declaration in cascade order, for shorthands whose longhands interleave (`border` then `border-top`). */
  readonly ordered: readonly Declaration[];
};

const EMPTY_STYLE: ElementStyle = { get: () => undefined, ordered: [] };

/**
 * The cascade of a set of style sheets over one parse5 tree. `of(element)` is
 * memoised per element. Sheets are given in increasing precedence (the
 * renderer's default sheet first, then the author's).
 */
export class Cascade {
  private readonly buckets = new Map<string, Rule[]>();
  private readonly cache = new Map<Element, ElementStyle>();

  constructor(
    sheets: readonly string[],
    private readonly budget: DocxWorkBudget,
  ) {
    const adapter = budgetedParse5Adapter(budget);
    let order = 0;
    for (const sheet of sheets) {
      let selectors = 0;
      let root;
      try {
        root = parseCss(sheet);
      } catch {
        continue;
      }
      root.walkRules((rule) => {
        if (selectors >= MAX_SELECTORS || !appliesToPrint(rule)) return;
        const declarations: Declaration[] = [];
        rule.each((child) => {
          if (child.type === 'decl') declarations.push({ property: child.prop.toLowerCase(), value: child.value.trim(), important: child.important });
        });
        if (declarations.length === 0) return;
        for (const selector of rule.selectors) {
          selectors += 1;
          if (selectors > MAX_SELECTORS) return;
          const compiled = compileRule(selector, adapter);
          if (!compiled) continue;
          const entry: Rule = { matches: compiled.matches, specificity: compiled.specificity, order: (order += 1), declarations };
          const bucket = this.buckets.get(compiled.bucket);
          if (bucket) bucket.push(entry);
          else this.buckets.set(compiled.bucket, [entry]);
        }
      });
    }
  }

  of(element: Element): ElementStyle {
    const cached = this.cache.get(element);
    if (cached) return cached;
    const candidates = [...(this.buckets.get('*') ?? []), ...(this.buckets.get(element.tagName) ?? [])];
    const classes = (attributeOf(element, 'class') ?? '').split(/[\t\n\f\r ]+/).filter((name) => name !== '');
    for (const name of new Set(classes)) candidates.push(...(this.buckets.get(`.${name}`) ?? []));
    const matched: Rule[] = [];
    for (const rule of candidates) {
      this.budget.spend();
      if (rule.matches(element)) matched.push(rule);
    }
    matched.sort((x, y) => compareSpecificity(x.specificity, y.specificity) || x.order - y.order);
    const inline = inlineDeclarations(attributeOf(element, 'style') ?? '');
    const normal = [...matched.flatMap((rule) => rule.declarations), ...inline];
    const ordered = [...normal.filter((declaration) => !declaration.important), ...normal.filter((declaration) => declaration.important)];
    if (ordered.length === 0) {
      this.cache.set(element, EMPTY_STYLE);
      return EMPTY_STYLE;
    }
    const winning = new Map<string, string>();
    for (const declaration of ordered) winning.set(declaration.property, declaration.value);
    const style: ElementStyle = { get: (property) => winning.get(property), ordered };
    this.cache.set(element, style);
    return style;
  }
}

/** One selector compiled for matching, or null when it cannot match an element we convert (a pseudo-element, a syntax css-select refuses). */
function compileRule(selector: string, adapter: Adapter<Node, Element>): { matches: (element: Element) => boolean; specificity: Specificity; bucket: string } | null {
  let parsed: Selector[][];
  try {
    parsed = parseSelector(selector);
  } catch {
    return null;
  }
  const tokens = parsed[0];
  if (parsed.length !== 1 || !tokens || tokens.some((token) => token.type === 'pseudo-element')) return null;
  try {
    const matches = compileSelector<Node, Element>(parsed, { adapter });
    return { matches: (element) => matches(element), specificity: specificityOf(tokens), bucket: bucketOf(tokens) };
  } catch {
    return null;
  }
}

/** CSS pixels per unit (96 per inch). */
const PX_PER: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, em: 16, rem: 16 };

/**
 * A length in CSS pixels, or null when it is not a plain length (`auto`, a
 * keyword, a function). `percentOf` is what 100% means for this property.
 */
export function lengthPx(value: string | undefined, percentOf = 0): number | null {
  if (value === undefined) return null;
  const match = /^(-?(?:\d{1,6}(?:\.\d{1,6})?|\.\d{1,6}))([a-z%]{0,4})$/i.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  if (unit === '') return number === 0 ? 0 : null;
  if (unit === '%') return (number / 100) * percentOf;
  const factor = PX_PER[unit];
  return factor === undefined ? null : number * factor;
}

/** Splits a value at whitespace outside parentheses (`1fr minmax(0, 2fr)` is two tracks). */
export function valueTokens(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[\t\n\f\r ]/.test(char)) {
      if (current !== '') tokens.push(current);
      current = '';
    } else current += char;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
const BORDER_STYLES = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);

/** The four values of a 1-4 value box shorthand (`margin: 1mm 2mm`), top, right, bottom, left. */
function boxValues(value: string): [string, string, string, string] | null {
  const parts = valueTokens(value);
  if (parts.length === 0 || parts.length > 4) return null;
  const [top, right = top, bottom = top, left = right] = parts as [string, string?, string?, string?];
  return [top, right!, bottom!, left!];
}

/**
 * Which sides of an element draw a line, from its declarations in cascade
 * order: `border`, `border-{side}`, `border-style`, `border-width` and their
 * longhands, each overriding what came before. A side draws when its style is
 * neither `none` nor `hidden` and its width is not zero.
 */
export function bordersOf(style: ElementStyle): Record<Side, boolean> {
  const state = Object.fromEntries(SIDES.map((side) => [side, { style: 'none', zero: false }])) as Record<Side, { style: string; zero: boolean }>;
  const applyShorthand = (sides: readonly Side[], value: string) => {
    const tokens = valueTokens(value.toLowerCase());
    const styleToken = tokens.find((token) => BORDER_STYLES.has(token));
    const zero = tokens.some((token) => lengthPx(token) === 0);
    for (const side of sides) state[side] = { style: styleToken ?? 'none', zero };
  };
  for (const { property, value } of style.ordered) {
    const lower = value.toLowerCase();
    if (property === 'border') applyShorthand(SIDES, value);
    else if (/^border-(top|right|bottom|left)$/.test(property)) applyShorthand([property.slice(7) as Side], value);
    else if (property === 'border-style') {
      const values = boxValues(lower);
      if (values) SIDES.forEach((side, index) => (state[side].style = values[index]!));
    } else if (property === 'border-width') {
      const values = boxValues(lower);
      if (values) SIDES.forEach((side, index) => (state[side].zero = lengthPx(values[index]) === 0));
    } else if (/^border-(top|right|bottom|left)-style$/.test(property)) state[property.split('-')[1] as Side].style = lower.trim();
    else if (/^border-(top|right|bottom|left)-width$/.test(property)) state[property.split('-')[1] as Side].zero = lengthPx(lower) === 0;
  }
  return Object.fromEntries(SIDES.map((side) => [side, state[side].style !== 'none' && state[side].style !== 'hidden' && !state[side].zero])) as Record<Side, boolean>;
}

/** The left margin or padding of an element in CSS pixels (`margin`, `margin-left`, `margin-inline-start` in cascade order). */
export function leadingSpacePx(style: ElementStyle, box: 'margin' | 'padding', percentOf: number): number {
  let value: string | undefined;
  for (const { property, value: declared } of style.ordered) {
    if (property === box) value = boxValues(declared)?.[3];
    else if (property === `${box}-left` || property === `${box}-inline-start` || property === `${box}-inline`) value = valueTokens(declared)[0];
  }
  return Math.max(0, lengthPx(value, percentOf) ?? 0);
}
