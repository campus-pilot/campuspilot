/**
 * Find-and-replace edits to a saved question paper (`editQuestionPaper`).
 *
 * A model that changes one line of a paper by writing the whole fragment again
 * also changes lines it was not asked to (spacing, classes, formulas). With
 * edits it names only the text to change; everything else is the saved
 * version's own text, so it cannot drift.
 */

export type QuestionPaperEdit = { find: string; replace: string };

export type AppliedEdits = { ok: true; html: string } | { ok: false; problems: string[] };

/** Where `find` occurs in `html`: at most two matches, enough to tell none, one and several apart. */
function matchesOf(html: string, pattern: RegExp): RegExpExecArray[] {
  const found: RegExpExecArray[] = [];
  for (let match = pattern.exec(html); match && found.length < 2; match = pattern.exec(html)) {
    found.push(match);
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return found;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The edit with its whitespace loosened, for a `find` copied with its line
 * breaks or indentation changed: any run of whitespace inside it stands for
 * any other run, and whitespace at its ends is left out of the match (and,
 * where `replace` starts or ends with the same whitespace, out of the
 * replacement), so the paper's own spacing around the match stays. Every
 * other character must be exact.
 */
function looseWhitespace(edit: QuestionPaperEdit): { pattern: RegExp; replace: string } {
  const leading = /^\s*/.exec(edit.find)![0];
  const trailing = /\s*$/.exec(edit.find)![0];
  let replace = edit.replace;
  if (leading && replace.startsWith(leading)) replace = replace.slice(leading.length);
  if (trailing && replace.endsWith(trailing)) replace = replace.slice(0, replace.length - trailing.length);
  const words = edit.find.trim().split(/\s+/).map(escapeRegExp);
  return { pattern: new RegExp(words.join('\\s+'), 'g'), replace };
}

const preview = (text: string) => JSON.stringify(text.length > 80 ? `${text.slice(0, 77)}...` : text);

/**
 * Applies `edits` in order, each to the result of the ones before it. Each
 * `find` must occur exactly once: as written, or else with its whitespace
 * loosened. All or nothing: any edit that does not apply returns the problems
 * and no html.
 */
export function applyQuestionPaperEdits(html: string, edits: readonly QuestionPaperEdit[]): AppliedEdits {
  let current = html;
  const problems: string[] = [];
  edits.forEach((edit, index) => {
    const label = `Edit ${index + 1} (find ${preview(edit.find)})`;
    if (edit.find.length === 0) {
      problems.push(`${label}: find is empty. Copy the exact text to change from the paper's html.`);
      return;
    }
    let found = matchesOf(current, new RegExp(escapeRegExp(edit.find), 'g'));
    let replace = edit.replace;
    if (found.length === 0 && edit.find.trim().length > 0) {
      const loose = looseWhitespace(edit);
      found = matchesOf(current, loose.pattern);
      replace = loose.replace;
    }
    if (found.length === 0) {
      problems.push(`${label}: this text is not in the paper. Copy it exactly from the html getQuestionPaper returned for this version, after the edits before it.`);
      return;
    }
    if (found.length > 1) {
      problems.push(`${label}: this text occurs more than once. Include more of the text around it so it occurs once.`);
      return;
    }
    const [match] = found;
    current = current.slice(0, match!.index) + replace + current.slice(match!.index + match![0].length);
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, html: current };
}
