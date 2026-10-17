import { ExamStudentWorkspace } from '@/components/exam/exam-student-workspace';
export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string; classId: string; studentId: string }> }) {
  const scope = await params;
  return <ExamStudentWorkspace key={JSON.stringify(scope)} scope={scope} />;
}
