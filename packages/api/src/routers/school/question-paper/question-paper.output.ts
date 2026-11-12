import { cleanDeclarations, cleanStyleSheet, StripReport } from './question-paper.css';

/**
 * The OUTPUT VERIFIER of the `question_paper_body` profile (html-design.md,
 * fix round 1): an exact grammar check of the sanitiser's result that fails
 * closed. It does not trust the sanitiser, and it does not use a second HTML
 * parser either: sanitize-html (htmlparser2) and the browser build different
 * trees from the same text, which is the whole class of bug this exists for.
 * Instead it checks that the string is written in a grammar so small that the
 * browser's tokenizer can only read it one way, whatever tree it builds:
 *
 * - text has no `<` or `>` (the sanitiser escapes them);
 * - every `<` starts a lowercase tag from the allowlist, with plain
 *   double-quoted attributes from the attribute allowlist (no `on*`), no
 *   comment, doctype, CDATA or processing instruction;
 * - the only element whose content the tokenizer does not read as markup is
 *   `<style>`; it must be written exactly `<style>`, outside any `<svg>` (inside
 *   svg a style element's text is parsed as markup and entities are decoded), and
 *   its text must hold no `<`, `&`, backslash or NUL and equal its own cleaned
 *   form. Its text can therefore never close it early, reopen markup, or mean
 *   something else in another parsing context;
 * - tags are balanced, `style=""` attributes equal their cleaned form, and no
 *   style positions anything out of flow.
 *
 * The renderer runs this on every render as well as the sanitiser on every
 * save, so the stored value and what is printed are checked by the same rules.
 */

/** Elements written without content, as `<br />`. */
const VOID = new Set(['br', 'hr', 'img', 'col']);

/**
 * Separators are the five ASCII whitespace characters of the HTML tokenizer (space, tab, line feed, form feed, carriage
 * return) and nothing else. JS `\s` also matches U+000B, U+00A0, U+3000, U+FEFF and U+2028, which the tokenizer reads as
 * part of a name, so a tag that looked like `<col dir="x">` to this check could be a differently named element to the browser.
 */
const WS = '[ \\t\\n\\f\\r]';
const TAG = new RegExp(`<(/?)([a-z][a-z0-9]*)((?:${WS}+[a-z][a-z0-9:_-]*(?:="[^"<>]*")?)*)${WS}*(/?)>`, 'y');
const ATTRIBUTE = new RegExp(`${WS}+([a-z][a-z0-9:_-]*)(?:="([^"]*)")?`, 'y');
const OUT_OF_FLOW = /position\s*:\s*(?:fixed|absolute|sticky)/i;
const STYLE_TEXT = /^[^<&\\\u0000]*$/;

export type ScannedElement = {
  name: string;
  /** Attribute values as the browser reads them (entities of `& < > "` decoded). */
  attributes: Readonly<Record<string, string>>;
  /** Number of open elements around it (0 at the top level); `<style>` blocks are not elements here and do not count. */
  depth: number;
};

export type ScannedOutput = { ok: true; elements: ScannedElement[]; styleTexts: string[] } | { ok: false; reason: string };

const unescapeAttribute = (value: string) => value.replace(/&(quot|lt|gt|amp|#39|#x27);/g, (_, name: string) => ({ quot: '"', lt: '<', gt: '>', amp: '&', '#39': "'", '#x27': "'" })[name]!);

/**
 * Scans sanitiser output. Returns the elements and style texts, or the first
 * way the string leaves the grammar above. `tags` and `attributes` are the
 * allowlists of the profile.
 */
export function scanQuestionPaperOutput(html: string, allowed: { tags: ReadonlySet<string>; attributes: ReadonlySet<string> }): ScannedOutput {
  const elements: ScannedElement[] = [];
  const styleTexts: string[] = [];
  const stack: string[] = [];
  let svgDepth = 0;
  let index = 0;
  const fail = (reason: string): ScannedOutput => ({ ok: false, reason });

  while (index < html.length) {
    const lt = html.indexOf('<', index);
    const text = html.slice(index, lt < 0 ? html.length : lt);
    if (text.includes('>')) return fail('unescaped ">" in text');
    if (lt < 0) break;

    TAG.lastIndex = lt;
    const match = TAG.exec(html);
    if (!match) return fail('a "<" that is not a plain allowed tag');
    index = lt + match[0].length;
    const [, slash, name, attributeText, selfClosing] = match as unknown as [string, string, string, string, string];
    if (!allowed.tags.has(name)) return fail(`the tag <${name}> is not allowed`);

    if (slash === '/') {
      if (VOID.has(name) || attributeText !== '' || selfClosing !== '') return fail(`a malformed closing tag </${name}>`);
      if (stack.pop() !== name) return fail(`</${name}> does not close the open element`);
      if (name === 'svg') svgDepth -= 1;
      continue;
    }

    const attributes: Record<string, string> = {};
    ATTRIBUTE.lastIndex = 0;
    for (let at = 0; at < attributeText.length; ) {
      ATTRIBUTE.lastIndex = at;
      const attribute = ATTRIBUTE.exec(attributeText);
      if (!attribute) return fail('a malformed attribute');
      at = ATTRIBUTE.lastIndex;
      const attributeName = attribute[1]!;
      if (/^on/.test(attributeName) || !allowed.attributes.has(attributeName)) return fail(`the attribute "${attributeName}" is not allowed`);
      if (attributeName in attributes) return fail(`the attribute "${attributeName}" is repeated`);
      const value = unescapeAttribute(attribute[2] ?? '');
      if (attributeName === 'style') {
        if (OUT_OF_FLOW.test(value) || cleanDeclarations(value, new StripReport()) !== value) return fail('a style attribute that is not clean');
      }
      attributes[attributeName] = value;
    }

    if (name === 'style') {
      if (attributeText !== '' || selfClosing !== '') return fail('a <style> with attributes');
      if (svgDepth > 0) return fail('a <style> inside an <svg>');
      const close = html.indexOf('</style>', index);
      if (close < 0) return fail('an unclosed <style>');
      const css = html.slice(index, close);
      if (!STYLE_TEXT.test(css) || OUT_OF_FLOW.test(css)) return fail('style text that is not plain CSS');
      if (cleanStyleSheet(css, new StripReport(), (element) => allowed.tags.has(element)) !== css) return fail('style text that is not clean');
      styleTexts.push(css);
      index = close + '</style>'.length;
      continue;
    }

    if (selfClosing === '/' && !VOID.has(name)) return fail(`<${name} /> is not allowed`);
    elements.push({ name, attributes, depth: stack.length });
    if (!VOID.has(name)) {
      stack.push(name);
      if (name === 'svg') svgDepth += 1;
    }
  }
  if (stack.length > 0) return fail(`<${stack.at(-1)}> is not closed`);
  return { ok: true, elements, styleTexts };
}
