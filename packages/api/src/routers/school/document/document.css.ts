import postcss, { type ChildNode, type Container } from "postcss";
import { EMBEDDABLE_IMAGE } from "./document.sanitize";

/**
 * The CSS rule of the `document` sanitiser profile: what a template's CSS
 * may load. A `url(...)` or `image-set(...)` survives only when every target
 * it names is a raster `data:` image (PNG, JPEG or WebP, base64) or one of
 * the exact asset names generated for the batch being converted
 * (`document.images.ts`). Anything else (a relative path, `file:`,
 * `http(s):`, an SVG `data:` URI) removes the whole declaration; `@import`
 * is removed whatever it names. Functions that can also load an image
 * (`image()`, `cross-fade()`, `element()`, `paint()`, `src()`) are removed
 * too. CSS escapes are decoded before checking, so `u\72l(` is read as
 * `url(`. CSS that does not parse is dropped whole.
 *
 * Why the code and not only the CSP: converted HTML with assets has
 * `img-src data: 'self'`, and `'self'` cannot be limited to file names, so
 * without this a `<style>` or `style=""` could reach other files Chromium may
 * read. Previews (no assets) apply the same rule with no names allowed.
 */

/** Functions that may load a resource; only `url` and `image-set` can be allowed, by their targets. */
const LOADING_FUNCTION = /(?:^|[^a-z0-9_-])(url|image-set|-webkit-image-set|image|cross-fade|-webkit-cross-fade|element|-moz-element|paint|src)\s*\(/gi;

/** Decodes CSS escapes (`\72`, `\72 `, `\(`), so a check reads what the browser reads. */
function decodeCssEscapes(value: string) {
  return value.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-fA-F])/g, (_match, hex: string | undefined, char: string | undefined) => {
    if (hex === undefined) return char ?? "";
    const code = Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
  });
}

/** The targets of every `url(...)`; null when one cannot be read with certainty. */
function urlTargets(value: string): string[] | null {
  const targets: string[] = [];
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]*))\s*\)/gi;
  let found = 0;
  for (const match of value.matchAll(pattern)) {
    found += 1;
    targets.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  const opened = (value.match(/url\s*\(/gi) ?? []).length;
  return opened === found ? targets : null;
}

/**
 * Whether a declaration value (or at-rule prelude) loads only allowed
 * targets. Escapes are decoded only to FIND loading functions (`u\72l(` is
 * `url(`); a value that loads anything and contains a backslash at all is
 * refused, because an escaped quote or parenthesis inside a URL string
 * (`url("a.png\")/../x.png")`) would make the checker read a different
 * target than Chromium resolves. Generated names and base64 data never need
 * a backslash.
 */
export function cssValueAllowed(raw: string, assets: ReadonlySet<string>): boolean {
  const value = decodeCssEscapes(raw);
  const functions = [...value.matchAll(LOADING_FUNCTION)].map((match) => match[1]!.toLowerCase());
  if (functions.length === 0) return true;
  if (raw.includes("\\")) return false;
  if (functions.some((name) => name !== "url" && name !== "image-set" && name !== "-webkit-image-set")) return false;
  const targets = urlTargets(value);
  if (targets === null) return false;
  // `image-set("a.png" 1x)` names targets as plain strings: every quoted string counts.
  if (functions.some((name) => name !== "url"))
    for (const match of value.matchAll(/"([^"]*)"|'([^']*)'/g)) targets.push(match[1] ?? match[2] ?? "");
  return targets.every((target) => {
    const trimmed = target.trim();
    return EMBEDDABLE_IMAGE.test(trimmed) || assets.has(trimmed);
  });
}

function cleanContainer(container: Container, assets: ReadonlySet<string>) {
  container.each((node: ChildNode) => {
    if (node.type === "atrule") {
      // An escaped at-rule name (`@i\mport`) ends at the backslash for postcss
      // (name `i`, the rest in the prelude) but Chromium reads `@import`: an
      // at-rule with a backslash in its name or prelude is dropped.
      if (node.name.includes("\\") || node.params.includes("\\") || node.name.toLowerCase() === "import" || !cssValueAllowed(node.params, assets)) {
        node.remove();
        return;
      }
      if (node.nodes) cleanContainer(node, assets);
      return;
    }
    if (node.type === "rule") {
      if (!cssValueAllowed(node.selector, assets)) {
        node.remove();
        return;
      }
      cleanContainer(node, assets);
      return;
    }
    if (node.type === "decl" && !cssValueAllowed(node.value, assets)) node.remove();
  });
}

/** A `<style>` element's text with every disallowed load removed; empty when it does not parse. */
export function cleanDocumentStyleSheet(css: string, assets: ReadonlySet<string>): string {
  try {
    const root = postcss.parse(css);
    cleanContainer(root, assets);
    return root.toString();
  } catch {
    return "";
  }
}

/** A `style=""` attribute's declarations with every disallowed load removed; empty when it does not parse. */
export function cleanDocumentStyleAttribute(style: string, assets: ReadonlySet<string>): string {
  try {
    const root = postcss.parse(`x{${style}}`);
    const [rule] = root.nodes;
    if (root.nodes.length !== 1 || rule?.type !== "rule") return "";
    cleanContainer(rule, assets);
    return rule.nodes.map((node) => node.toString()).join(";");
  } catch {
    return "";
  }
}

/**
 * Cleans the text of every `<style>` element of sanitize-html's output. That
 * output escapes `<` everywhere except inside raw-text elements, so every
 * `<style` in it starts a real element, and its text ends at the first
 * `</style` (the parser ended it there).
 */
export function cleanStyleElements(html: string, assets: ReadonlySet<string>): string {
  return html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_match, open: string, css: string, close: string) => `${open}${cleanDocumentStyleSheet(css, assets)}${close}`);
}
