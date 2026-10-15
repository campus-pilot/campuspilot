import { DocumentTemplateSettings } from '@/components/documents/document-template-settings';
export default async function Page({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return (
    <DocumentTemplateSettings schoolId={schoolId} documentType="admit_card" />
  );
}
