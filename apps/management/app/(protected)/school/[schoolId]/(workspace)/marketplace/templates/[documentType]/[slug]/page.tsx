import { notFound } from 'next/navigation';
import { DocumentTemplateMarketplaceDetail } from '@/components/documents/document-template-marketplace';
import { documentTypeSchema } from '@campuspilot/api/routers/school/document/document.dto';

export default async function Page({
  params,
}: {
  params: Promise<{
    schoolId: string;
    documentType: string;
    slug: string;
  }>;
}) {
  const { schoolId, documentType, slug } = await params;
  const type = documentTypeSchema.safeParse(documentType);
  if (!type.success) notFound();
  return (
    <DocumentTemplateMarketplaceDetail
      scope={{ schoolId, documentType: type.data }}
      slug={slug}
    />
  );
}
