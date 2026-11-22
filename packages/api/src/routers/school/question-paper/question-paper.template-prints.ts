import type { DatabaseExecutor } from '@campuspilot/db';
import { ORPCError } from '@orpc/server';
import { defaultTreeAdapter as tree, parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

import type { QuestionPaperContext, QuestionPaperPrintsContext } from './question-paper.context';
import { QUESTION_PAPER_TEMPLATE_PRINTS_LINE_CHARS, QUESTION_PAPER_TEMPLATE_PRINTS_LINES, type TemplatePrints } from './question-paper.dto';
import { leanLines } from './question-paper.lean';
import { buildPaperPrintsContext } from './question-paper.print-context';
import { renderQuestionPaperTemplate, selectedQuestionPaperTemplate } from './question-paper.render';
import { paperSchoolIdOf, printLayoutOf, type ResolvedPaper } from './question-paper.scope';
import { STANDALONE_QUESTION_PAPER_PRINTS } from './question-paper.standalone-shell';

/**
 * WHAT THE SCHOOL'S TEMPLATE PRINTS AROUND A PAPER, AS TEXT.
 *
 * The author of a paper (the generation job's model, a chat agent) writes only
 * the body; the heading and the footer come from the school's template. An
 * author that is merely told "the template prints the school name, exam, class
 * and so on" has to guess which lines of a photographed heading are already
 * printed, and a school's template is free HTML, so the guess is wrong in both
 * directions: lines are written twice ("Half Yearly Examination" under the
 * template's own exam line) or dropped although nothing prints them (the time
 * allowed, which no template can print: `questionPaper.timeAllowed` is always
 * null).
 *
 * So the lines are READ, not assumed: the selected template is rendered for
 * this very paper exactly as a print renders it (same context, same sanitiser,
 * the slot still in place) and the text before and after the slot is listed.
 * The result is advice for an author and nothing else: it is never stored, no
 * check depends on it and a print never reads it.
 */

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

/** The slot's own id (`QUESTION_PAPER_SLOT`); the document sanitiser keeps `id`, and the slot check proved there is exactly one. */
const SLOT_ID = 'qp-body-slot';

/** Elements whose content is never printed text. */
const UNPRINTED = new Set(['head', 'style', 'script', 'title', 'template', 'noscript']);

/**
 * Elements that start and end a line of their own. Table cells are among
 * them, so a heading laid out as a table ("Examination: … | Class: …") is
 * listed fact by fact rather than as one run-on line.
 */
const BLOCKS = new Set([
  'html', 'body', 'address', 'article', 'aside', 'blockquote', 'caption', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul',
]);

const isSlot = (element: Element) => tree.getAttrList(element).some((attribute) => attribute.name === 'id' && attribute.value === SLOT_ID);

/**
 * The text lines of a rendered template document (sanitised, with the slot
 * still in it) on each side of the slot, in reading order: one line per block
 * element, table cell or `<br>`, whitespace collapsed, empty lines left out.
 * Null when the slot is not an element of the parsed document (a template
 * that hides it inside a `<style>`): the sides cannot be told apart then, and
 * "not known" must not be mistaken for "prints nothing".
 *
 * Only text is read. What CSS adds or hides (`::before` content, `display:
 * none`, a page counter) is not evaluated; an image has no line.
 */
export function templatePrintsOf(renderedTemplateHtml: string): TemplatePrints | null {
  const sides = { above: [] as string[], below: [] as string[] };
  let side: keyof typeof sides = 'above';
  let found = false;
  let run = '';
  const endLine = () => {
    const line = run.replace(/\s+/g, ' ').trim();
    run = '';
    if (line !== '') sides[side].push(line);
  };
  const walk = (node: Node): void => {
    if (tree.isTextNode(node)) {
      run += tree.getTextNodeContent(node);
      return;
    }
    if (!tree.isElementNode(node)) return;
    const name = tree.getTagName(node);
    if (UNPRINTED.has(name)) return;
    if (isSlot(node)) {
      endLine();
      side = 'below';
      found = true;
      return;
    }
    if (name === 'br') {
      endLine();
      return;
    }
    const block = BLOCKS.has(name);
    if (block) endLine();
    for (const child of tree.getChildNodes(node)) walk(child);
    if (block) endLine();
  };
  for (const child of tree.getChildNodes(parse(renderedTemplateHtml, { scriptingEnabled: false }))) walk(child);
  endLine();
  if (!found) return null;
  const lean = (lines: string[], listed: number) => leanLines(lines, { listed, lineChars: QUESTION_PAPER_TEMPLATE_PRINTS_LINE_CHARS });
  return { above: lean(sides.above, QUESTION_PAPER_TEMPLATE_PRINTS_LINES.above), below: lean(sides.below, QUESTION_PAPER_TEMPLATE_PRINTS_LINES.below) };
}

/**
 * What one template prints around the body for one context, or null when the
 * template does not render for it.
 *
 * A template that fails to render (a BAD_REQUEST of the document renderer:
 * bad syntax, an unknown helper, an oversized result) is deliberately "not
 * known" here and not an error: this is advice for an author, and the place
 * that reports a broken template is the save or the preview, with the
 * renderer's own message. Reading a paper must keep working while its
 * school's template is broken. Any other error is a real failure and is thrown.
 */
export function templatePrintsFor(templateContent: string, context: QuestionPaperContext | QuestionPaperPrintsContext): TemplatePrints | null {
  try {
    return templatePrintsOf(renderQuestionPaperTemplate(templateContent, context));
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'BAD_REQUEST') return null;
    throw error;
  }
}

/**
 * What the school's currently selected template prints around the body of
 * this paper (the template a save would print it with), or null when that is
 * not known: the school has selected no template, or the template does not
 * render for this paper ({@link templatePrintsFor}). A `plain` paper (a
 * personal space's) prints nothing around its body: two empty lists. A quick
 * paper's lines are rendered with its current details, and a detail it does
 * not state yet as a placeholder (`withDetailPlaceholders`: "[class]",
 * "[maximum marks]"), so a line the template prints only for a known value
 * still shows.
 *
 * `generatedAt` is the instant a template that prints the date shows; a
 * caller that must repeat the same lines later (the generation job) journals
 * the result instead of reading it twice.
 */
export async function readTemplatePrints(db: DatabaseExecutor, scope: ResolvedPaper, generatedAt: Date = new Date()): Promise<TemplatePrints | null> {
  if (printLayoutOf(scope) === 'plain') return STANDALONE_QUESTION_PAPER_PRINTS;
  const template = await selectedQuestionPaperTemplate(db, paperSchoolIdOf(scope));
  if (!template) return null;
  // The version number of a paper that is being written is not known yet, exactly as in a draft preview.
  return templatePrintsFor(template.content, await buildPaperPrintsContext(db, scope, generatedAt));
}
