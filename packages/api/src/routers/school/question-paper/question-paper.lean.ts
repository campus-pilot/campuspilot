import { QUESTION_PAPER_VALIDATE_LINE_CHARS, QUESTION_PAPER_VALIDATE_LISTED } from './question-paper.dto';

/**
 * The lines of a validate result as the tool lists them: at most
 * {@link QUESTION_PAPER_VALIDATE_LISTED}, each cut to
 * {@link QUESTION_PAPER_VALIDATE_LINE_CHARS}, with one last line counting the
 * rest. Keeps the result small whatever the paper holds (a paper with hundreds
 * of bad formulas must not fill the chat's context), while the first lines are
 * what the model fixes first.
 */
export function leanLines(lines: readonly string[]): string[] {
  const clip = (line: string) => (line.length > QUESTION_PAPER_VALIDATE_LINE_CHARS ? `${line.slice(0, QUESTION_PAPER_VALIDATE_LINE_CHARS - 1)}…` : line);
  const listed = lines.slice(0, QUESTION_PAPER_VALIDATE_LISTED).map(clip);
  return lines.length > listed.length ? [...listed, `and ${lines.length - listed.length} more`] : listed;
}
