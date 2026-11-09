'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { InstallAppScreen } from '@campuspilot/components/install-app-screen';
import { useInstallAppScreen } from '@campuspilot/components/install-app-state';
import { orpc } from '@/lib/orpc';
import { SchoolAvatar } from './school-avatar';

const dismissKey = (schoolId: string) =>
  `campuspilot.management.installDismissedUntil:${schoolId}`;

/**
 * Covers every page under `/school/{schoolId}` on phones, outside the
 * installed app, with an invitation to install this school's app. "Continue
 * here" hides it for this school for a week. Mounted once, in the
 * `[schoolId]` layout, so no lower layout repeats it.
 */
export function SchoolInstallGate({
  schoolId,
  children,
}: {
  schoolId: string;
  children: ReactNode;
}) {
  const screen = useInstallAppScreen(dismissKey(schoolId));
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  const school = schoolsQuery.data?.find((candidate) => candidate.id === schoolId);

  return (
    <>
      {children}
      {screen.visible && school ? (
        <InstallAppScreen
          schoolLogo={<SchoolAvatar school={school} size="sm" />}
          schoolName={school.name}
          status={screen.status}
          onInstall={screen.onInstall}
          onContinue={screen.onContinue}
        />
      ) : null}
    </>
  );
}
