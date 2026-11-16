/**
 * The links on the user's screen, for the voice overlay's "open what I can
 * see" (`open_on_screen`): the voice model names a thing ("Second Term
 * Examination"), and the overlay follows the link whose text matches it best.
 *
 * Two kinds of things count, never buttons (a button may do something:
 * delete, approve, send):
 * - links that stay inside the user's school, wherever they are drawn (the
 *   page, the sidebar, the breadcrumbs), except the overlay's own;
 * - table rows that open their record when clicked (`data-opens-record`, set
 *   by the shared data table), opened by the same click the user would make.
 * Everything drawn on the page counts, also what the user would have to scroll
 * to: the assistant is told the whole page's text (`screen-text.ts`), so it
 * may name anything on it. Opening one is what the user could do by scrolling
 * to it and clicking; what is hidden (a closed menu, a collapsed section) does
 * not count.
 */

/**
 * Something on the screen that opens a page: its visible text and what tells
 * it apart (a link's path, or the row's place in the page for a row).
 */
export type ScreenLink = { text: string; href: string };

/** Lower case, letters and digits only, single spaces: "Class 8-B" and "class 8 b" compare equal. */
function normalised(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Words that never tell two links apart: "the annual examination page" is the
 * annual examination.
 */
const FILLER = new Set(['the', 'a', 'an', 'page', 'screen', 'tab', 'section']);

const wordsOf = (text: string) => normalised(text).split(' ').filter((word) => word && !FILLER.has(word));

/** How well a link's text answers a label: the label's words it holds, and the share of each side that is shared. */
function matchOf(label: string, link: ScreenLink) {
  const wanted = wordsOf(label);
  const words = wordsOf(link.text);
  const have = new Set(words);
  const matched = new Set(wanted.filter((word) => have.has(word))).size;
  return { matched, ofLabel: wanted.length ? matched / wanted.length : 0, ofLink: words.length ? matched / words.length : 0, labelWords: wanted.length, linkWords: words.length };
}

/** The least share of the label's words a link must hold to be opened. */
const MIN_LABEL_SHARE = 0.75;

/**
 * Whether a link answers the label at all. Either it holds most of the label
 * ("second term" on the card "Second Term Examination, exam plan generated"),
 * or the label holds all of the link's words and they are at least half of the
 * label ("admit card templates" for the link "Admit card"): a one-word link
 * such as "View" never answers a long request that merely contains its word.
 */
function answers(match: ReturnType<typeof matchOf>): boolean {
  if (match.matched === 0) return false;
  if (match.ofLabel >= MIN_LABEL_SHARE) return true;
  return match.ofLink === 1 && match.linkWords >= Math.ceil(match.labelWords / 2);
}

type Ranked = { link: ScreenLink; exact: number; matched: number; ofLabel: number; starts: number };

/**
 * The links that answer `label`, best first, one per place. Ranked only by
 * what the label says: the exact text, then the most of the label's words,
 * then the share of the label, then a text that starts with the label. A word
 * the label does not name never decides, so "Open English Oral for Nursery"
 * and "… for Class 1", asked for "English Oral", stay level. Of several links
 * to one place the best ranked is kept (an exact breadcrumb over a card that
 * says more), after sorting, not in page order.
 */
function ranked(label: string, links: readonly ScreenLink[]): Ranked[] {
  const target = normalised(label);
  const sorted = links
    .map((link) => {
      const text = normalised(link.text);
      const match = matchOf(label, link);
      return { link, match, exact: text === target ? 1 : 0, matched: match.matched, ofLabel: match.ofLabel, starts: text.startsWith(target) ? 1 : 0 };
    })
    .filter((entry) => answers(entry.match))
    .sort((a, b) => b.exact - a.exact || b.matched - a.matched || b.ofLabel - a.ofLabel || b.starts - a.starts);
  const seen = new Set<string>();
  return sorted.filter((entry) => !seen.has(entry.link.href) && seen.add(entry.link.href));
}

const level = (a: Ranked, b: Ranked) => a.exact === b.exact && a.matched === b.matched && a.ofLabel === b.ofLabel && a.starts === b.starts;

/**
 * The places that answer `label` equally well at the top, when there are two
 * or more: the label does not say which, so the user must be asked. Empty when
 * one place answers best or none answers.
 */
export function closestLinks(label: string, links: readonly ScreenLink[]): ScreenLink[] {
  const [best, ...rest] = ranked(label, links);
  if (!best) return [];
  const tied = rest.filter((entry) => level(entry, best));
  return tied.length ? [best, ...tied].map((entry) => entry.link) : [];
}

/**
 * The link to open for `label`, or null when none answers it or two different
 * places answer it equally well (then the user must say which, see
 * {@link closestLinks}). "Class 1" wins over "Class 10" by its exact text.
 */
export function bestLink(label: string, links: readonly ScreenLink[]): ScreenLink | null {
  const [best, next] = ranked(label, links);
  if (!best) return null;
  return next && level(next, best) ? null : best.link;
}

/**
 * The links in the order to offer them when none was opened: those sharing the
 * most of the label's words first, the rest in page order. A paper asked for
 * in a few more words than its link holds ("English oral question paper for
 * Class 1") is then among the texts the model gets back, not cut by the sidebar
 * links above it.
 */
export function nearestFirst(label: string, links: readonly ScreenLink[]): ScreenLink[] {
  return links
    .map((link) => ({ link, matched: matchOf(label, link).matched }))
    .sort((a, b) => b.matched - a.matched)
    .map((entry) => entry.link);
}

/** The distinct texts of the links, for the voice model to choose from when nothing matched. */
export function linkTexts(links: readonly ScreenLink[], max = 40): string[] {
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const link of links) {
    const text = link.text.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    texts.push(text);
    if (texts.length === max) break;
  }
  return texts;
}

/**
 * Whether something of this size and visibility is drawn on the page. Where it
 * is does not matter: a link far below the window is as much on the page as
 * one in view.
 */
export function drawnOnPage(box: { width: number; height: number }, visible: boolean): boolean {
  return visible && box.width >= 2 && box.height >= 2;
}

const isDrawn = (element: Element) => drawnOnPage(element.getBoundingClientRect(), element.checkVisibility());

/**
 * What a link or row is called, on one line: its accessible name when it has
 * one, as a screen reader would say it, else its text. A table's "Open" links
 * are told apart that way ("Open English Written for Nursery"), and an
 * icon-only link gets a name at all.
 */
const textOf = (element: HTMLElement) => (element.getAttribute('aria-label') || element.innerText || '').replace(/\s+/g, ' ').trim();

/**
 * What can be opened inside `root` now: links that stay inside the school
 * (`/school/{schoolId}/…` on this origin) and rows that open their record,
 * each drawn on the page, with the way to open it.
 */
export function screenLinks(root: Element, schoolId: string, skip: string | null = null): { links: ScreenLink[]; follow: (link: ScreenLink, navigate: (href: string) => void) => void } {
  const prefix = `/school/${encodeURIComponent(schoolId)}`;
  const links: ScreenLink[] = [];
  const rows = new Map<string, HTMLElement>();
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (skip && anchor.closest(skip)) continue;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || !(url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) continue;
    const text = textOf(anchor);
    if (text && isDrawn(anchor)) links.push({ text, href: `${url.pathname}${url.search}` });
  }
  root.querySelectorAll<HTMLElement>('[data-opens-record]').forEach((row, index) => {
    if (skip && row.closest(skip)) return;
    const text = textOf(row).replaceAll('\t', ' ');
    if (!text || !isDrawn(row)) return;
    const key = `row:${index}`;
    rows.set(key, row);
    links.push({ text, href: key });
  });
  return {
    links,
    follow: (link, navigate) => {
      const row = rows.get(link.href);
      if (row) row.click();
      else navigate(link.href);
    },
  };
}
