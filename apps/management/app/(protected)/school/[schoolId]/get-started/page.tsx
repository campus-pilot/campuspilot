import { SchoolOnboarding } from '@/components/school-onboarding/school-onboarding';

/** The guided setup of a school its owner just created (docs/school-creation.md, "Guided setup"). */
export default async function SchoolGetStartedPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  return <SchoolOnboarding schoolId={schoolId} />;
}
