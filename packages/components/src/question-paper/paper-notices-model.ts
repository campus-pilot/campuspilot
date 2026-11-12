/**
 * The label of the collapsed list of notices: "2 notices". Generic on purpose: most notices say what
 * the sanitiser removed, but a saved version can also carry a notice that it was saved in an earlier
 * format (migration 0064), and that must not read as "about what was removed".
 * It counts notices (one line per kind of change, with its own "(3 times)" inside the line),
 * which is also what the version list, the version card and the tab badge count, so every
 * place says the same number for the same paper.
 */
export function removedSummary(count: number) {
  return `${count} ${count === 1 ? 'notice' : 'notices'}`;
}

/** The sentence for figures that are still a labelled box, or null when none are. */
export function placeholderNote(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'figure is' : 'figures are'} still a placeholder. Attach the image in chat to put it in.`;
}
