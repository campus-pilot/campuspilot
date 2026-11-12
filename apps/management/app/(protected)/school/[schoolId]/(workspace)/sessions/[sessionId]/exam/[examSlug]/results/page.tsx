import { ExamResultsPage } from '@/components/exam/exam-results-page';
export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string }> }) {
  const scope = await params; return <ExamResultsPage key={JSON.stringify(scope)} scope={scope} />;
}
