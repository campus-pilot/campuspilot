import {
  templateDocumentTypeSchema as documentTypeSchema,
  type TemplateDocumentType as DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';
import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { SETTINGS_TEMPLATES } from '../settings-templates';

/**
 * What a marketplace address names. The marketplace has its own section
 * (`app/.../(marketplace)/marketplace/templates`) with one address per view:
 * - `/school/:schoolId/marketplace/templates`: no type yet (opens the first one);
 * - `…/templates/:type`: a type (opens the design the school uses, else the first);
 * - `…/templates/:type/:slug`: a design (its catalog slug);
 * - `…/templates/:type/:slug?preview=1`: that design's full-screen preview.
 *
 * Each value is only a request: the screen shows it when the school has that
 * type and the catalog lists that design, and the server decides every read
 * again.
 */
export type MarketplaceRequest = {
  type: DocumentType | null;
  template: string | null;
  preview: boolean;
};

/**
 * The marketplace's address for a request. A design is named only with its
 * type, and the preview only with its design, so the address never asks for a
 * preview of nothing. The slug is encoded as one path segment.
 */
export function marketplaceHref(schoolId: string, request: Partial<MarketplaceRequest> = {}) {
  let path = `/school/${encodeURIComponent(schoolId)}/marketplace/templates`;
  if (!request.type) return path;
  path += `/${request.type}`;
  if (!request.template) return path;
  path += `/${encodeURIComponent(request.template)}`;
  return request.preview ? `${path}?preview=1` : path;
}

/**
 * The longest slug the API accepts (`marketplaceTemplateInputSchema`: any
 * 1 to 100 characters). A longer `template` in an old link is not a design
 * request at all, so it opens the type instead of a design page.
 */
const MAX_SLUG_CHARS = 100;

/**
 * Reads the marketplace's former address,
 * `/school/:schoolId/marketplace/templates?type=…&template=…&preview=1`, from
 * the time it was one page with tabs. Only used to redirect old links.
 */
export function legacyMarketplaceRequestOf(search: { get(name: string): string | null }): MarketplaceRequest {
  const type = documentTypeSchema.safeParse(search.get('type'));
  const template = search.get('template');
  return {
    type: type.success ? type.data : null,
    template: template && template.length <= MAX_SLUG_CHARS ? template : null,
    preview: search.get('preview') === '1',
  };
}

/**
 * Where an old `?type=&template=&preview=1` link now points, or null when it
 * names no valid type (the address is then the marketplace's root already, so
 * redirecting would only loop).
 */
export function legacyMarketplaceRedirect(schoolId: string, search: { get(name: string): string | null }): string | null {
  const request = legacyMarketplaceRequestOf(search);
  return request.type ? marketplaceHref(schoolId, request) : null;
}

/** One feature's state as `resolveSchoolFeature` reports it, as far as the marketplace needs it. */
type FeatureView = { enabled: boolean; status: 'pending' | 'unknown' | 'ready' };

/**
 * The document types this school has templates for, in the order of the
 * settings templates (`SETTINGS_TEMPLATES`), each decided from its own
 * feature (`DOCUMENT_TYPE_FEATURE`: notices for the Notice template, the
 * assistant for the question paper's, student management for the rest; the
 * server refuses the others).
 *
 * `status` is `pending` while any of those features is still being read, so
 * the marketplace never opens a type only to switch when the flags arrive,
 * and `unknown` when one could not be read, so it offers a retry rather than
 * saying the school has no templates.
 */
export function marketplaceTypesOf(feature: (key: SchoolFeatureKey) => FeatureView): {
  types: DocumentType[];
  status: FeatureView['status'];
} {
  const views = SETTINGS_TEMPLATES.map((template) => ({ type: template.documentType, view: feature(template.feature) }));
  const status = views.some(({ view }) => view.status === 'pending')
    ? 'pending'
    : views.some(({ view }) => view.status === 'unknown')
      ? 'unknown'
      : 'ready';
  return { types: views.filter(({ view }) => view.enabled).map(({ type }) => type), status };
}

/**
 * The type the marketplace's root opens: the first type the school has whose
 * templates the user may read (`mayRead`; finance types have their own read
 * permission, so a role may read Bills but not Report cards). Null when the
 * user may read none, so the root says so instead of opening a type that
 * would only refuse.
 */
export function landingTypeOf(types: readonly DocumentType[], mayRead: (type: DocumentType) => boolean): DocumentType | null {
  return types.find(mayRead) ?? null;
}

/** The type an address names when the school has it, else null (no fallback: the screen says so instead). */
export function offeredTypeOf(requested: DocumentType | null, offered: readonly DocumentType[]): DocumentType | null {
  return requested && offered.includes(requested) ? requested : null;
}

/**
 * The design a type's address opens: the design the school uses now, when it
 * was imported from the catalog and is still listed (`inUseSlug` is the
 * selected revision's own `marketplaceSlug`, never inferred from a name);
 * else the first design listed; null when none is.
 */
export function defaultDesignOf(listed: readonly string[], inUseSlug: string | null): string | null {
  if (inUseSlug && listed.includes(inUseSlug)) return inUseSlug;
  return listed[0] ?? null;
}

/**
 * The paper a design prints on. A Notice design has no footprint of its own:
 * each notice chooses full or half A4 and the design adapts (`print.size`).
 */
export function footprintLabel(design: { documentType: DocumentType; pageSize: 'full' | 'half' }) {
  if (design.documentType === 'notice') return 'Full or half A4 · each notice chooses';
  return design.pageSize === 'half' ? 'Half A4 · two per sheet' : 'Full A4 · one per sheet';
}
