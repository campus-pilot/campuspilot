/**
 * Pure helpers for the HTML fragment a model writes. Free of Node, DB and
 * React dependencies, like the rest of this package, so the API, the worker
 * and the browser can all import it.
 */

const FENCE = /```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/g;
const OPENING_FENCE = /^\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n/;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;

/**
 * The fragment inside a model's text answer. Models often wrap HTML in a
 * Markdown code fence and add a sentence before or after it; the fragment is
 * the content of the longest fenced block when there is one, else the text
 * itself. An unterminated fence (an answer cut off by the output limit) loses
 * only its opening line. A leading `<!DOCTYPE ...>` is dropped; everything else
 * (`<html>`, `<head>`, `<body>`) is left to the sanitiser, which discards
 * those tags and keeps their content.
 *
 * It does not judge the result: an empty string is returned as an empty
 * string and the caller reports it.
 */
export function extractQuestionPaperFragment(text: string): string {
  let best: string | null = null;
  for (const match of text.matchAll(FENCE)) {
    const block = match[1] ?? '';
    if (best === null || block.length > best.length) best = block;
  }
  let fragment = best ?? text;
  if (best === null && OPENING_FENCE.test(fragment)) fragment = fragment.replace(OPENING_FENCE, '');
  return fragment.replace(DOCTYPE, '').trim();
}

/** Why an extracted answer is not an HTML fragment at all. */
export type QuestionPaperFragmentShapeProblem = {
  /** `no_markup`: no element anywhere (a refusal or chatter); `stray_text`: text before the first or after the last element. */
  kind: 'no_markup' | 'stray_text';
  message: string;
};

/**
 * Checks the SHAPE of an extracted answer before anything is cleaned: a fragment
 * has an element in it, starts with one and ends with one. A model's refusal
 * ("I'm sorry, I cannot...") or preamble ("Here is the HTML:") would otherwise
 * be kept as text and printed as the paper. Returns null for a fragment.
 */
export function questionPaperFragmentShapeProblem(fragment: string): QuestionPaperFragmentShapeProblem | null {
  const text = fragment.trim();
  if (!/<[a-zA-Z]/.test(text)) {
    return { kind: 'no_markup', message: 'The answer is not an HTML fragment: it has no HTML elements.' };
  }
  if (!text.startsWith('<') || !text.endsWith('>')) {
    return {
      kind: 'stray_text',
      message: 'Return only the HTML fragment: it must start with an element and end with one, with no sentence before or after it.',
    };
  }
  return null;
}

const BLOCK_ELEMENT = /<(?:p|div|h[1-6]|ul|ol|table|figure)[\s>]/;

/**
 * Whether CLEANED markup holds a paper: at least one block element and some
 * visible text (or a formula). Text and elements that only a `<style>` or a
 * drawing carried do not count.
 */
export function hasPaperContent(cleanedHtml: string): boolean {
  if (!BLOCK_ELEMENT.test(cleanedHtml)) return false;
  if (/data-math="/.test(cleanedHtml)) return true;
  return cleanedHtml.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '').trim() !== '';
}
