import { ExamSettings } from '@/components/exam/exam-settings';

export default async function Page({ params }: {
  params: Promise<{ schoolId: string; sessionId: string; examSlug: string }>;
}) {
  const scope = await params;
  return <ExamSettings key={JSON.stringify(scope)} scope={scope} />;
}
