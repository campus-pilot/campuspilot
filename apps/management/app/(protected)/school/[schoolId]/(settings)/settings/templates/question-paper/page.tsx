import { DocumentTemplateSettings } from '@/components/documents/document-template-settings';
import { FeaturePage } from '@/components/feature-unavailable';

/** The question paper template exists only for schools with the AI assistant feature. */
export default async function QuestionPaperTemplatePage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return (
    <FeaturePage feature="assistant">
      <DocumentTemplateSettings schoolId={schoolId} documentType="question_paper" />
    </FeaturePage>
  );
}
