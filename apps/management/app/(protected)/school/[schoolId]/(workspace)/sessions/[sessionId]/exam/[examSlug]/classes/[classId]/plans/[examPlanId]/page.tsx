import { redirect } from 'next/navigation';
import { examClassHref } from '@/components/exam/exam-model';
/** Preserve old subject-first links while making the class roster canonical. */
export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string; classId: string; examPlanId: string }> }) {
  redirect(examClassHref(await params));
}
