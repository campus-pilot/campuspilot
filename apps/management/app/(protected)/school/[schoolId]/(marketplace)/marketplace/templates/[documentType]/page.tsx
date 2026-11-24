import { notFound } from 'next/navigation';
import { templateDocumentTypeSchema as documentTypeSchema } from '@campuspilot/api/routers/school/document/document.dto';
import { MarketplaceTypeLanding } from '@/components/documents/document-template-marketplace';

/** A document type's address: the client opens the type's default design (`MarketplaceTypeLanding`). */
export default async function Page({ params }: { params: Promise<{ schoolId: string; documentType: string }> }) {
  const { schoolId, documentType } = await params;
  const type = documentTypeSchema.safeParse(documentType);
  if (!type.success) notFound();
  return <MarketplaceTypeLanding schoolId={schoolId} documentType={type.data} />;
}
