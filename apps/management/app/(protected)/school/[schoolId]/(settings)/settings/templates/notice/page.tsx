import { DocumentTemplateSettings } from '@/components/documents/document-template-settings';
import { FeaturePage } from '@/components/feature-unavailable';

/** The Notice template exists only for schools with the notices feature. */
export default async function NoticeTemplatePage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return (
    <FeaturePage feature="notices">
      <DocumentTemplateSettings schoolId={schoolId} documentType="notice" />
    </FeaturePage>
  );
}
