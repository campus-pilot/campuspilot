import { DocumentTemplateSettings } from '@/components/documents/document-template-settings';

export default async function StatementTemplatePage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  return <DocumentTemplateSettings schoolId={schoolId} documentType="statement" />;
}
