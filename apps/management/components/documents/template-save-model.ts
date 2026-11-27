/** The paper footprint of a template revision. */
export type TemplateFootprint = 'full' | 'half';

/**
 * The footprint the Save dialog starts with (docs/document-system.md,
 * "Saving a template"). A footprint belongs to a design: when the HTML about
 * to be saved is the loaded revision's own, its footprint is offered as it
 * stands in the editor; when the HTML differs (a pasted design, an assistant
 * draft, a restored revision, edits) the dialog starts with none, so the
 * person chooses it for the design they are saving. This is what keeps a
 * design pasted over a marketplace template from silently inheriting that
 * template's footprint. Types without a footprint choice never ask.
 */
export function initialSaveFootprint(input: {
  /** Whether the type offers half A4 at all (`HALF_PAGE_DOCUMENT_TYPES`). */
  choosable: boolean;
  /** The HTML that Save would store. */
  content: string;
  /** The loaded (selected) revision's HTML. */
  loadedContent: string;
  /** The footprint in the editor now. */
  pageSize: TemplateFootprint;
}): TemplateFootprint | null {
  if (!input.choosable) return input.pageSize;
  return input.content === input.loadedContent ? input.pageSize : null;
}
