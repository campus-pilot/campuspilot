import { notFound, redirect } from 'next/navigation';
import { documentTypeSchema } from '@campuspilot/api/routers/school/document/document.dto';
import { marketplaceHref } from '@/components/documents/marketplace-model';

/**
 * The former dedicated preview page of a marketplace design. Links to it keep
 * working: it opens the marketplace on that type and design with the
 * full-screen preview open. A design the catalog no longer lists is said so
 * there, beside the type's other designs.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ schoolId: string; documentType: string; slug: string }>;
}) {
  const { schoolId, documentType, slug } = await params;
  const type = documentTypeSchema.safeParse(documentType);
  if (!type.success) notFound();
  redirect(marketplaceHref(schoolId, { type: type.data, template: slug, preview: true }));
}
