import { ExamLanding } from '@/components/exam/exam-landing';

/**
 * The examination root. It shows nothing of its own: it sends the user to the
 * Question paper or the Results section (`defaultExamSection`), so existing
 * links to the root keep working.
 */
export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string }> }) {
  const scope = await params; return <ExamLanding key={JSON.stringify(scope)} scope={scope} />;
}
