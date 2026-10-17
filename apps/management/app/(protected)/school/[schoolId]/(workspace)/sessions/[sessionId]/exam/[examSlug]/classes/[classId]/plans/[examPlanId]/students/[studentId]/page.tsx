import { redirect } from 'next/navigation';
import { examStudentHref } from '@/components/exam/exam-model';
/** Old saved bookmarks now open the student's complete exam. */
export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string; classId: string; examPlanId: string; studentId: string }> }) {
  redirect(examStudentHref(await params));
}
