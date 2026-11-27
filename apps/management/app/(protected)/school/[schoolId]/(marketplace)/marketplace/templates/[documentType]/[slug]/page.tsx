import { notFound } from 'next/navigation';
import { templateDocumentTypeSchema } from '@campuspilot/api/routers/school/document/document.dto';
import { MarketplaceDesignPage } from '@/components/documents/document-template-marketplace';

/**
 * A marketplace design's address. `?preview=1` opens its full-screen
 * preview, which the client reads and rewrites itself. The slug is only ever
 * compared with the slugs the catalog lists (see `MarketplaceDesignPage`).
 */
export default async function Page({
  params,
}: {
  params: Promise<{ schoolId: string; documentType: string; slug: string }>;
}) {
  const { schoolId, documentType, slug } = await params;
  // Only types with templates of their own have marketplace designs (a Bill due is printed with the bill template).
  const type = templateDocumentTypeSchema.safeParse(documentType);
  if (!type.success) notFound();
  return <MarketplaceDesignPage schoolId={schoolId} documentType={type.data} slug={slug} />;
}
