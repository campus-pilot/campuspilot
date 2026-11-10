import type { Metadata } from 'next';
import { SchoolAiPage } from '@/components/assistant/school-ai-page';

export const metadata: Metadata = {
  title: 'AI | CampusPilot Admin',
};

export default async function AiUsagePage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return <SchoolAiPage schoolId={schoolId} />;
}
