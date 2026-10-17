import { ExamClassStudents } from '@/components/exam/exam-class-students';
export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string; classId: string }> }) {
  const scope = await params;
  return <ExamClassStudents key={JSON.stringify(scope)} scope={scope} />;
}
