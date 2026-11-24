import type { AppShellBreadcrumb } from '@campuspilot/components/app-shell';
import { DOCUMENT_LABELS, documentTypeSchema } from '@campuspilot/api/routers/school/document/document.dto';
import { LayoutTemplate, Store } from 'lucide-react';
import { marketplaceHref } from '@/components/documents/marketplace-model';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';
import { TEMPLATE_ICONS } from '@/components/settings-navigation';

/**
 * The marketplace's route parameters, plus the design's name. `designName` is
 * not in the address: the layout takes it from the open type's catalog, which
 * it reads for the sidebar anyway, and leaves it empty while that is unread,
 * unreadable or does not list the slug (the trail then ends at the type).
 */
export type MarketplaceRouteParams = SchoolRouteParams & {
  documentType: string;
  slug: string;
  designName: string;
};

/**
 * Home › Template marketplace › type › design, like Settings' trail. Every
 * crumb but the last links: the marketplace's root opens its first type, a
 * type opens its default design.
 */
function marketplaceBreadcrumbs({ schoolId, documentType, designName }: MarketplaceRouteParams): AppShellBreadcrumb[] {
  const crumbs: AppShellBreadcrumb[] = [
    ...schoolPageBreadcrumbs(schoolId, { id: 'template-marketplace', label: 'Template marketplace', icon: Store }),
  ];
  const type = documentTypeSchema.safeParse(documentType);
  if (type.success) {
    crumbs.push({ id: 'marketplace-type', label: DOCUMENT_LABELS[type.data], icon: TEMPLATE_ICONS[type.data] });
    if (designName) crumbs.push({ id: 'marketplace-design', label: designName, icon: LayoutTemplate });
  }
  // Each crumb links to its own address, except the page being shown.
  return crumbs.map((crumb, index) => {
    if (index === crumbs.length - 1) return { ...crumb, href: undefined };
    if (crumb.id === 'template-marketplace') return { ...crumb, href: marketplaceHref(schoolId) };
    if (crumb.id === 'marketplace-type' && type.success) return { ...crumb, href: marketplaceHref(schoolId, { type: type.data }) };
    return crumb;
  });
}

/** The marketplace's root, a type and a design share one page descriptor; the trail follows the parameters. */
export const templateMarketplacePage = defineManagementPage<MarketplaceRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/marketplace\/templates(\/[^/]+){0,2}$/.test(pathname),
  title: 'Template marketplace',
  breadcrumbs: marketplaceBreadcrumbs,
});
