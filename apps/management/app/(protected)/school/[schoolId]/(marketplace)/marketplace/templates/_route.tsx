import {
  isMarketplacePath,
  marketplaceBreadcrumbs,
  type MarketplaceRouteParams,
} from '@/components/documents/marketplace-breadcrumbs';
import { defineManagementPage } from '@/components/management-route';

/** The marketplace's root, a type and a design share one page descriptor; the trail follows the parameters. */
export const templateMarketplacePage = defineManagementPage<MarketplaceRouteParams>({
  matches: isMarketplacePath,
  title: 'Template marketplace',
  breadcrumbs: marketplaceBreadcrumbs,
});
