import { ASSISTANT_PAGE_TEXT_MAX } from '@campuspilot/assistant-contract/dto';

/**
 * The text of the page the user is on, for the assistant
 * (`pageContext.pageText`, and the voice model's `read_screen`), so "this
 * page", "these students" and "all the classes here" mean what the page holds.
 *
 * It is read from the page as it is drawn, not from any page's data, so it
 * works on every screen without that screen knowing about the assistant:
 * - the whole page at once, above and below the window included, so a
 *   question about the page never waits for the user to scroll;
 * - what the user has in view right now is marked, for "what do I see now";
 * - pieces of text on one visual row (a table row's cells, a label and its
 *   value) become one line, in reading order;
 * - only what the page has drawn: hidden tabs, closed menus and the rows of
 *   other pages of a paginated table are not there to read.
 */

/** One piece of text on the page, with where it is drawn (page coordinates, not the window's). */
export type ScreenPiece = { top: number; left: number; text: string; inView: boolean };

/** Pieces whose tops are within this many pixels are on the same visual row. */
const SAME_ROW_PX = 6;

/** The lines that frame the part of the page in the user's view. */
export const IN_VIEW_START = '--- on the user’s screen now: from here ---';
export const IN_VIEW_END = '--- on the user’s screen now: up to here ---';

/** Where the page text was cut to fit. */
export const CUT_ABOVE = '… (more of the page above, left out)';
export const CUT_BELOW = '… (more of the page below, left out)';

type Line = { text: string; inView: boolean };

/** The pieces as lines in reading order: rows top to bottom, the pieces of a row left to right joined by " | ". */
function linesOf(pieces: readonly ScreenPiece[]): Line[] {
  const sorted = pieces
    .map((piece) => ({ ...piece, text: piece.text.replace(/\s+/g, ' ').trim() }))
    .filter((piece) => piece.text.length > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: ScreenPiece[][] = [];
  for (const piece of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(piece.top - row[0]!.top) <= SAME_ROW_PX) row.push(piece);
    else rows.push([piece]);
  }
  return rows.map((row) => ({
    text: row.sort((a, b) => a.left - b.left).map((piece) => piece.text).join(' | '),
    inView: row.some((piece) => piece.inView),
  }));
}

/**
 * Which lines to keep within `limit` characters: all of them when they fit;
 * otherwise the lines in view first, then the page after them, then the page
 * before them, so the part the user is looking at is never the part cut.
 */
function keptRange(lines: readonly Line[], limit: number): [number, number] {
  const cost = (line: Line) => line.text.length + 1;
  const total = lines.reduce((sum, line) => sum + cost(line), 0);
  if (total <= limit) return [0, lines.length];
  const firstInView = lines.findIndex((line) => line.inView);
  let start = firstInView === -1 ? 0 : firstInView;
  let end = start;
  let used = 0;
  while (end < lines.length && used + cost(lines[end]!) <= limit) used += cost(lines[end++]!);
  while (start > 0 && used + cost(lines[start - 1]!) <= limit) used += cost(lines[--start]!);
  return [start, end];
}

/**
 * The page's text: its lines in reading order, the part in view framed by
 * {@link IN_VIEW_START} and {@link IN_VIEW_END}, cut at whole lines to fit
 * `limit` characters with a note where something was left out.
 */
export function screenLines(pieces: readonly ScreenPiece[], limit: number = ASSISTANT_PAGE_TEXT_MAX): string {
  const lines = linesOf(pieces);
  // The notes and frames take room too.
  const budget = limit - (IN_VIEW_START.length + IN_VIEW_END.length + CUT_ABOVE.length + CUT_BELOW.length + 4);
  const [start, end] = keptRange(lines, budget);
  const out: string[] = [];
  if (start > 0) out.push(CUT_ABOVE);
  let inView = false;
  for (const line of lines.slice(start, end)) {
    if (line.inView && !inView) out.push(IN_VIEW_START);
    if (!line.inView && inView) out.push(IN_VIEW_END);
    inView = line.inView;
    out.push(line.text);
  }
  if (inView) out.push(IN_VIEW_END);
  if (end < lines.length) out.push(CUT_BELOW);
  return lines.length === 0 ? '' : out.join('\n');
}

/** Whether a box is drawn at all (a screen-reader-only element is a 1px box and is not). */
const drawn = (rect: DOMRect) => rect.width > 1 && rect.height > 1;

/** Whether a box is inside the window now. */
const inWindow = (rect: DOMRect) => rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;

/**
 * The text of everything drawn inside `root`, above and below the window
 * included, with what its fields hold. Hidden elements and anything marked
 * `aria-hidden` are left out.
 */
export function pageText(root: Element): string {
  const pieces: ScreenPiece[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.nodeValue?.trim() || !parent || parent.closest('[aria-hidden="true"], script, style, noscript')) continue;
    if (!parent.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (drawn(rect)) pieces.push({ top: rect.top + window.scrollY, left: rect.left, text: node.nodeValue, inView: inWindow(rect) });
  }
  // What a field holds is not a text node: a search box's words, a chosen date.
  for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=hidden]):not([type=password]):not([type=file]), textarea')) {
    const rect = field.getBoundingClientRect();
    if (!field.value.trim() || !drawn(rect) || !field.checkVisibility()) continue;
    const name = field.getAttribute('aria-label') ?? field.placeholder;
    pieces.push({ top: rect.top + window.scrollY, left: rect.left, text: name ? `${name}: ${field.value}` : field.value, inView: inWindow(rect) });
  }
  return screenLines(pieces);
}

/**
 * The page under the voice overlay, for its `read_screen`: the window's title
 * and the text of the app's content (`main`, which holds the top bar, the
 * breadcrumbs and the page; never the sidebar or the overlay, which are
 * outside it).
 */
export function readPageUnderOverlay(): { title: string; text: string } {
  const page = document.querySelector('main');
  return { title: document.title.trim(), text: page ? pageText(page) : '' };
}
