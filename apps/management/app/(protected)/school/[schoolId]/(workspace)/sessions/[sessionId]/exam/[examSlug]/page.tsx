import { ExamWorkspace } from '@/components/exam/exam-workspace';

export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string }> }) {
  const scope = await params;
  return <ExamWorkspace key={JSON.stringify(scope)} scope={scope} />;
}
