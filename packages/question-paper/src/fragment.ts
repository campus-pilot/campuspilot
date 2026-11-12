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
