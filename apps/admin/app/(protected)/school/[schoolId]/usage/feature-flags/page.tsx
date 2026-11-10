import type { Metadata } from 'next';
import { SchoolFeatureFlags } from '@/components/school-feature-flags';

export const metadata: Metadata = {
  title: 'Feature Flags | CampusPilot Admin',
};

export default async function FeatureFlagsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return <SchoolFeatureFlags schoolId={schoolId} />;
}
