import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AssistantVoiceOverlay } from '@/components/assistant/voice/assistant-voice-overlay';
import { SchoolInstallGate } from '@/components/school-install-gate';
import { SchoolAccessBoundary } from '@/components/school-selection';
import { OnlyInRealSchool } from '@/components/personal-space/school-kind-gates';

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
      <SchoolInstallGate schoolId={schoolId}>
        {children}
        {/* Above every page and both shells, so a voice session survives navigation inside the school. A personal space has no voice mode. */}
        <OnlyInRealSchool schoolId={schoolId}>
          <AssistantVoiceOverlay schoolId={schoolId} />
        </OnlyInRealSchool>
      </SchoolInstallGate>
    </SchoolAccessBoundary>
  );
}

