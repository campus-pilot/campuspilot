import { defaultTreeAdapter, html as htmlNamespace, parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { ScannedElement } from './question-paper.output';

/**
 * The TREE-BUILDER CHECK of the `question_paper_body` profile (fix round 3,
 * review-html-2-backend.md M1).
 *
 * The output grammar ({@link scanQuestionPaperOutput}) proves the string is
 * tokenised one way and that its tags are balanced, but a browser builds the
 * tree with implied end tags: a `<li>` start closes the open `<li>` and every
 * element above it (a `<div>` too), a `<p>` is closed by a block start tag, a
 * stray `<td>` is dropped, a table gets an implied `<tbody>`, `<svg><p>` breaks
 * out of the drawing. The model's later `</div>` then closes a different div
 * than the grammar believes, and the template's own container or the
 * `.qp-body` wrapper ends early, so the rest of the paper (and the footer)
 * lands outside the wrapper and loses its styles.
 *
 * This module parses the fragment the way the browser does (parse5 is the
 * WHATWG tree builder the browsers' conformance suites use) INSIDE the real
 * wrapper element, `<div class="qp-body">`, followed by a sentinel element, and
 * compares the tree it builds with the element list the grammar scanned:
 * same names, same nesting depth, nothing between the wrapper and the
 * sentinel. When they agree, the stored text means to the browser exactly what
 * the sanitiser and the grammar saw. When they do not, `normalised` is the
 * serialisation of the tree the browser builds, which the sanitiser cleans again
 * and re-checks until the text is a fixed point of the real tree builder.
 *
 * Comparison is by structure, not by string: parse5 writes `<br>` where the
 * sanitiser writes `<br />`, so a string round trip would never settle.
 */

/** The class the renderer gives the wrapper (`composeBody` in question-paper.body.ts). */
const WRAPPER_OPEN = '<div class="qp-body">';
const WRAPPER_CLOSE = '</div>';
const SENTINEL = '<i data-qp-end></i>';

type Parent = DefaultTreeAdapterMap['parentNode'];

/** Scripting is off: no script survives the sanitiser, and a browser that renders the paper to PDF runs none of it. */
const PARSE_OPTIONS = { scriptingEnabled: false };

/** The context a browser uses for a fragment that sits in the template's container: a block element in the body. */
const CONTEXT = defaultTreeAdapter.createElement('div', htmlNamespace.NS.HTML, []);

export type TreeCheck =
  | { faithful: true }
  | {
      faithful: false;
      /** What differs, for tests and logs (never shown to a teacher). */
      reason: string;
      /** The fragment as the browser's tree builder reads it, serialised; `''` when nothing could be read. */
      normalised: string;
      /** Names of elements the written fragment has and the browser's tree does not (a stray `<td>`, a `<col>` outside a table). Extras the browser adds, such as `<tbody>`, are not listed. */
      dropped: string[];
    };

/** Elements in document order with their depth below `parent`, leaving out `<style>` (the grammar does not list it) and text. */
function treeElements(parent: Parent, depth: number, out: Array<{ name: string; depth: number }>): void {
  for (const child of defaultTreeAdapter.getChildNodes(parent)) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    const name = defaultTreeAdapter.getTagName(child);
    if (name === 'style') continue;
    out.push({ name: name.toLowerCase(), depth });
    treeElements(child, depth + 1, out);
  }
}

/**
 * Checks that the browser's tree for `html` (already accepted by the output
 * grammar, which produced `scanned`) is the tree the grammar saw, inside the
 * wrapper. Linear in the input.
 */
export function checkQuestionPaperTree(html: string, scanned: readonly ScannedElement[]): TreeCheck {
  const root = parseFragment(CONTEXT, `${WRAPPER_OPEN}${html}${WRAPPER_CLOSE}${SENTINEL}`, PARSE_OPTIONS);
  const top = defaultTreeAdapter.getChildNodes(root);
  const wrapper = top[0];
  const sentinel = top[1];
  const wrapperIntact =
    top.length === 2 &&
    wrapper !== undefined && defaultTreeAdapter.isElementNode(wrapper) && defaultTreeAdapter.getTagName(wrapper) === 'div' &&
    sentinel !== undefined && defaultTreeAdapter.isElementNode(sentinel) && defaultTreeAdapter.getTagName(sentinel) === 'i';

  // The normal form is the fragment alone in a block context: a stray close tag has nothing to pop there, so the tree it
  // yields has no content outside it, and written back out it is balanced the way the browser reads it.
  const normalised = () => serialize(parseFragment(CONTEXT, html, PARSE_OPTIONS));
  const dropped = (built: ReadonlyArray<{ name: string }>) => {
    const kept = new Map<string, number>();
    for (const { name } of built) kept.set(name, (kept.get(name) ?? 0) + 1);
    const lost: string[] = [];
    for (const { name } of scanned) {
      const left = kept.get(name) ?? 0;
      if (left > 0) kept.set(name, left - 1);
      else lost.push(name);
    }
    return lost;
  };
  if (!wrapperIntact) {
    const whole: Array<{ name: string; depth: number }> = [];
    treeElements(parseFragment(CONTEXT, html, PARSE_OPTIONS), 0, whole);
    return { faithful: false, reason: 'content left the wrapper', normalised: normalised(), dropped: dropped(whole) };
  }

  const built: Array<{ name: string; depth: number }> = [];
  treeElements(wrapper as Parent, 0, built);
  const same =
    built.length === scanned.length &&
    built.every((element, index) => element.name === scanned[index]!.name && element.depth === scanned[index]!.depth);
  if (same) return { faithful: true };
  return { faithful: false, reason: 'the tree builder builds a different tree', normalised: normalised(), dropped: dropped(built) };
}
