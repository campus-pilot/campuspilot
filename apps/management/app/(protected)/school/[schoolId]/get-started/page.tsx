import { RealSchoolOnly } from '@/components/personal-space/school-kind-gates';
import { SchoolOnboarding } from '@/components/school-onboarding/school-onboarding';

/** The guided setup of a school its owner just created (docs/school-creation.md, "Guided setup"). */
export default async function SchoolGetStartedPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  // A personal space has no guided setup (docs/personal-space.md).
  return (
    <RealSchoolOnly schoolId={schoolId}>
      <SchoolOnboarding schoolId={schoolId} />
    </RealSchoolOnly>
  );
}
