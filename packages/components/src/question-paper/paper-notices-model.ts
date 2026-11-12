/** The label of the collapsed list of removed items: "2 things were removed". */
export function removedSummary(count: number) {
  return `${count} ${count === 1 ? 'thing was' : 'things were'} removed`;
}

/** The sentence for figures that are still a labelled box, or null when none are. */
export function placeholderNote(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'figure is' : 'figures are'} still a placeholder. Attach the image in chat to put it in.`;
}
