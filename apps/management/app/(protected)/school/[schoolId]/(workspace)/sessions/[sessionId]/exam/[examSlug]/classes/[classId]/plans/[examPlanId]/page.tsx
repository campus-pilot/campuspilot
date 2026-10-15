import { ExamResultRoster } from '@/components/exam/exam-result-roster';

export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string; classId: string; examPlanId: string }> }) {
  const scope = await params;
  return <ExamResultRoster key={JSON.stringify(scope)} scope={scope} />;
}
