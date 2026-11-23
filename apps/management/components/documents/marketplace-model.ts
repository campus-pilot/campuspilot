import {
  documentTypeSchema,
  type DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';

/**
 * What the marketplace's address asks for:
 * `/school/:schoolId/marketplace/templates?type=…&template=…&preview=1`.
 * - `type`: the document type tab.
 * - `template`: the design shown under it (its catalog slug).
 * - `preview`: the design is open in the full-screen preview dialog.
 *
 * Each value is only a request: the screen shows it when the school has that
 * type and the catalog lists that design (see {@link selectedTypeOf} and
 * {@link selectedDesignOf}), and the server decides every read again.
 */
export type MarketplaceRequest = {
  type: DocumentType | null;
  template: string | null;
  preview: boolean;
};

/**
 * The longest slug the API accepts (`marketplaceTemplateInputSchema`: any
 * 1 to 100 characters). The address takes any such value rather than a
 * stricter pattern of its own, so a design the catalog no longer lists is
 * still told apart from no request ("no longer in the marketplace"). The
 * value is only ever compared with the listed slugs and sent as API input;
 * React escapes it wherever it is shown.
 */
const MAX_SLUG_CHARS = 100;

export function marketplaceRequestOf(search: { get(name: string): string | null }): MarketplaceRequest {
  const type = documentTypeSchema.safeParse(search.get('type'));
  const template = search.get('template');
  return {
    type: type.success ? type.data : null,
    template: template && template.length <= MAX_SLUG_CHARS ? template : null,
    preview: search.get('preview') === '1',
  };
}

/**
 * The marketplace's address for a request. A design is named only with its
 * type, and the preview dialog only with its design, so the address never
 * asks for a preview of nothing.
 */
export function marketplaceHref(schoolId: string, request: Partial<MarketplaceRequest> = {}) {
  const query = new URLSearchParams();
  if (request.type) {
    query.set('type', request.type);
    if (request.template) {
      query.set('template', request.template);
      if (request.preview) query.set('preview', '1');
    }
  }
  const suffix = query.toString();
  const path = `/school/${encodeURIComponent(schoolId)}/marketplace/templates`;
  return suffix ? `${path}?${suffix}` : path;
}

/**
 * The type tab that is open: the requested one when the school has it (its
 * features decide which types it has), else the first type it has. Null when
 * it has none.
 */
export function selectedTypeOf(requested: DocumentType | null, offered: readonly DocumentType[]): DocumentType | null {
  if (requested && offered.includes(requested)) return requested;
  return offered[0] ?? null;
}

/**
 * The design shown under a type, in order of precedence: the requested slug
 * when the catalog lists it; else the design the school uses now, when it was
 * imported from the catalog and is still listed (`inUseSlug` is the selected
 * revision's own `marketplaceSlug`, never inferred from a name); else the
 * first design listed. `missing` says a requested design is not listed (an
 * old link), so the screen can say why it shows another one.
 */
export function selectedDesignOf(
  requested: string | null,
  listed: readonly string[],
  inUseSlug: string | null,
): { slug: string | null; missing: boolean } {
  if (requested && listed.includes(requested)) return { slug: requested, missing: false };
  const fallback = inUseSlug && listed.includes(inUseSlug) ? inUseSlug : (listed[0] ?? null);
  return { slug: fallback, missing: requested !== null };
}

/**
 * The paper a design prints on. A Notice design has no footprint of its own:
 * each notice chooses full or half A4 and the design adapts (`print.size`).
 */
export function footprintLabel(design: { documentType: DocumentType; pageSize: 'full' | 'half' }) {
  if (design.documentType === 'notice') return 'Full or half A4 · each notice chooses';
  return design.pageSize === 'half' ? 'Half A4 · two per sheet' : 'Full A4 · one per sheet';
}
