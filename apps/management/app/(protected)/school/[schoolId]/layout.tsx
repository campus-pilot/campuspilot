import type { ReactNode } from 'react';
import { SchoolAccessBoundary } from '@/components/school-selection';

export default async function SelectedSchoolLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return (
    <SchoolAccessBoundary schoolId={schoolId}>{children}</SchoolAccessBoundary>
  );
}

