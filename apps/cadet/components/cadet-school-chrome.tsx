'use client';

import { InstallAppScreen } from '@campuspilot/components/install-app-screen';
import { useInstallAppScreen } from '@campuspilot/components/install-app-state';
import { Avatar, AvatarFallback } from '@campuspilot/ui/components/avatar';
import { env } from '@campuspilot/env/cadet.client';
import { useQuery } from '@tanstack/react-query';

import { orpc } from '@/lib/orpc';

type CadetSchool = { id: string; name: string; hasLogo: boolean };

/** The public manifest that installs this school's Cadet Portal as its own app (API origin). */
function cadetManifestHref(schoolId: string) {
  return new URL(`/blob/school/${encodeURIComponent(schoolId)}/cadet.webmanifest`, env.NEXT_PUBLIC_SERVER_URL).toString();
}

/** The public logo rendering; browser icons only (root AGENTS.md on `/blob/*`). */
function schoolIconHref(schoolId: string) {
  return new URL(`/blob/school/${encodeURIComponent(schoolId)}/logo?size=192`, env.NEXT_PUBLIC_SERVER_URL).toString();
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/**
 * Manifest and home-screen icon of the student's school. React 19 hoists
 * `<link>` into `<head>` and removes it on unmount, so no effect is needed.
 * Only signed-in pages render it: before sign-in the school is unknown and
 * the portal is not installable.
 */
function CadetSchoolHead({ school }: { school: CadetSchool }) {
  return (
    <>
      <link rel="manifest" href={cadetManifestHref(school.id)} />
      <link rel="apple-touch-icon" href={school.hasLogo ? schoolIconHref(school.id) : '/apple-icon.png'} />
    </>
  );
}

const dismissKey = (schoolId: string) => `campuspilot.cadet.installDismissedUntil:${schoolId}`;

/**
 * On phones, outside the installed app, invites the student to install the
 * school's Cadet Portal (needed on iPhone for notifications), like
 * management's school install gate. "Continue here" hides it for a week.
 * The school's logo is not fetched here (in-page logos need a permissioned
 * URL); its initials stand in.
 */
function CadetInstallGate({ school }: { school: CadetSchool }) {
  const screen = useInstallAppScreen(dismissKey(school.id));
  if (!screen.visible) return null;
  return (
    <InstallAppScreen
      schoolLogo={
        <Avatar size="sm">
          <AvatarFallback>{initials(school.name)}</AvatarFallback>
        </Avatar>
      }
      schoolName={school.name}
      status={screen.status}
      onInstall={screen.onInstall}
      onContinue={screen.onContinue}
    />
  );
}

/**
 * School-specific chrome of every signed-in Cadet page: the installable
 * manifest, the home-screen icon and the install invitation.
 */
export function CadetSchoolChrome() {
  const school = useQuery(orpc.getSchool.queryOptions({ staleTime: 60 * 60 * 1_000 }));
  if (!school.data) return null;
  return (
    <>
      <CadetSchoolHead school={school.data} />
      <CadetInstallGate school={school.data} />
    </>
  );
}
