import { QUESTION_PAPER_VALIDATE_LINE_CHARS, QUESTION_PAPER_VALIDATE_LISTED } from './question-paper.dto';

/**
 * The lines of a validate result as the tool lists them: at most
 * {@link QUESTION_PAPER_VALIDATE_LISTED}, each cut to
 * {@link QUESTION_PAPER_VALIDATE_LINE_CHARS}, with one last line counting the
 * rest. Keeps the result small whatever the paper holds (a paper with hundreds
 * of bad formulas must not fill the chat's context), while the first lines are
 * what the model fixes first.
 *
 * `limits` is for another list that is told to a model under its own numbers
 * (the lines a template prints, `question-paper.template-prints.ts`): the same
 * cut and the same counting last line, so no list is ever shown as complete
 * when it is not.
 */
export function leanLines(
  lines: readonly string[],
  limits: { listed: number; lineChars: number } = { listed: QUESTION_PAPER_VALIDATE_LISTED, lineChars: QUESTION_PAPER_VALIDATE_LINE_CHARS },
): string[] {
  const clip = (line: string) => (line.length > limits.lineChars ? `${line.slice(0, limits.lineChars - 1)}…` : line);
  const listed = lines.slice(0, limits.listed).map(clip);
  return lines.length > listed.length ? [...listed, `and ${lines.length - listed.length} more`] : listed;
}
