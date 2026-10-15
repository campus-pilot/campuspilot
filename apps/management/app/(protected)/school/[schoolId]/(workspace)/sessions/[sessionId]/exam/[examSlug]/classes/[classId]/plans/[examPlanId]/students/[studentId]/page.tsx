import { ExamStudentResult } from '@/components/exam/exam-student-result';

export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string; classId: string; examPlanId: string; studentId: string }> }) {
  const scope = await params;
  return <ExamStudentResult key={JSON.stringify(scope)} scope={scope} />;
}
