import { ExamList } from '@/components/exam/exam-list';

export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string }> }) {
  const scope = await params;
  return <ExamList key={JSON.stringify(scope)} scope={scope} />;
}
