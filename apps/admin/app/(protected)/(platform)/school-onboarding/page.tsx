import type { Metadata } from 'next';
import { SchoolOnboardingTable } from '@/components/school-onboarding/school-onboarding-table';

export const metadata: Metadata = {
  title: 'School Onboarding | CampusPilot Admin',
};

export default function SchoolOnboardingPage() {
  return <SchoolOnboardingTable />;
}
