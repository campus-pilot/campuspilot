import { QuestionPaperPage } from '@/components/question-paper/question-paper-page';
export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string }> }) {
  const scope = await params; return <QuestionPaperPage key={JSON.stringify(scope)} scope={scope} />;
}
