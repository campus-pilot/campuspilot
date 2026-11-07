import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SchoolInstallGate } from '@/components/school-install-gate';
import { SchoolAccessBoundary } from '@/components/school-selection';

/**
 * Clears the app-wide title, icons and manifest for everything inside a
 * school. `SchoolDocumentHead` renders them on the client instead, from the
 * school's name and logo. Keeping both would leave two titles, competing icons
 * and two manifests, and the browser would keep CampusPilot's.
 */
export const metadata: Metadata = { title: null, icons: null, manifest: null };

export default async function SelectedSchoolLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return (
    <SchoolAccessBoundary schoolId={schoolId}>
      <SchoolInstallGate schoolId={schoolId}>{children}</SchoolInstallGate>
    </SchoolAccessBoundary>
  );
}

