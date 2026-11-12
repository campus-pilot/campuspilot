/**
 * The label of the collapsed list of removed parts: "2 notices about what was removed".
 * It counts notices (one line per kind of change, with its own "(3 times)" inside the line),
 * which is also what the version list, the version card and the tab badge count, so every
 * place says the same number for the same paper.
 */
export function removedSummary(count: number) {
  return `${count} ${count === 1 ? 'notice' : 'notices'} about what was removed`;
}

/** The sentence for figures that are still a labelled box, or null when none are. */
export function placeholderNote(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'figure is' : 'figures are'} still a placeholder. Attach the image in chat to put it in.`;
}
