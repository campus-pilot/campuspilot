import { redirect } from 'next/navigation';
import { MarketplaceLanding } from '@/components/documents/document-template-marketplace';
import { legacyMarketplaceRedirect } from '@/components/documents/marketplace-model';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The marketplace's root. An old `?type=&template=&preview=1` link (from the
 * time the marketplace was one page with tabs) is redirected on the server to
 * the matching type or design address; otherwise the client opens the first
 * type the school has once its features are known.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { schoolId } = await params;
  const query = await searchParams;
  const legacy = legacyMarketplaceRedirect(schoolId, {
    get: (name) => {
      const value = query[name];
      return (Array.isArray(value) ? value[0] : value) ?? null;
    },
  });
  if (legacy) redirect(legacy);
  return <MarketplaceLanding schoolId={schoolId} />;
}
