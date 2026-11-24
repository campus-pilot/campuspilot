import { DocumentTemplateMarketplace } from '@/components/documents/document-template-marketplace';

/** The type, design and preview shown are read from the address by the marketplace itself (`marketplace-model.ts`). */
export default async function Page({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  return <DocumentTemplateMarketplace schoolId={schoolId} />;
}
