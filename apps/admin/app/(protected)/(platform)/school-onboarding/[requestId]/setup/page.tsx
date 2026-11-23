import type { Metadata } from 'next';
import { SchoolSetupBoundary } from '@/components/school-onboarding/setup/school-setup-boundary';

export const metadata: Metadata = {
  title: 'Set Up School | CampusPilot Admin',
};

export default async function SchoolSetupRoute({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <SchoolSetupBoundary requestId={requestId} />;
}
