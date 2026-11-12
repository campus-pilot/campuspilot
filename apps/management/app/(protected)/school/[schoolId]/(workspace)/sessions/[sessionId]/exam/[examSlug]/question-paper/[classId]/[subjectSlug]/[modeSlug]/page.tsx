import { QuestionPaperWorkspace } from '@/components/question-paper/question-paper-workspace';
export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string; classId: string; subjectSlug: string; modeSlug: string }> }) {
  const scope = await params; return <QuestionPaperWorkspace key={JSON.stringify(scope)} scope={scope} />;
}
