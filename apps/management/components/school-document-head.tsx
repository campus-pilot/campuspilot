'use client';

import { useQuery } from '@tanstack/react-query';
import type { MySchoolDto } from '@campuspilot/api/routers/school/school.dto';
import { env } from '@campuspilot/env/management.client';
import { orpc } from '@/lib/orpc';
import { DEFAULT_APP_ICONS } from './app-icons';

/** Separates the page title from the school name, e.g. "Admission · Springfield High". */
const TITLE_SEPARATOR = ' · ';

/** Shown until the school's name is known. */
const FALLBACK_TITLE = 'CampusPilot';

/**
 * The public manifest that installs this school as its own app. It lives on
 * the API origin; browsers fetch it in CORS mode without credentials.
 */
function schoolManifestHref(schoolId: string) {
  return new URL(
    `/blob/school/${encodeURIComponent(schoolId)}/manifest.webmanifest`,
    env.NEXT_PUBLIC_SERVER_URL,
  ).toString();
}

/**
 * The public, non-expiring logo rendering. Only browser icons use it; logos
 * shown inside pages keep using the permissioned `school.getLogo` URL.
 */
function schoolIconHref(schoolId: string, size: 192 | 512) {
  return new URL(
    `/blob/school/${encodeURIComponent(schoolId)}/logo?size=${size}`,
    env.NEXT_PUBLIC_SERVER_URL,
  ).toString();
}

/**
 * The only source of the browser tab's title, icons and web-app manifest
 * inside a school; the `[schoolId]` layout clears the app-wide metadata. The
 * title becomes "{page} · {school}", the school's logo is the favicon and
 * home-screen icon (CampusPilot's icons when it has none), and installing the
 * app from here installs this school as its own app.
 *
 * React 19 hoists `<title>` and `<link>` into `<head>` and removes them on
 * unmount, so no effect is needed. The school comes from the cached
 * `listMySchools` query that `SchoolAccessBoundary` already resolved.
 */
export function SchoolDocumentHead({
  schoolId,
  pageTitle,
}: {
  schoolId: string;
  pageTitle?: string;
}) {
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  const school = schoolsQuery.data?.find(
    (candidate) => candidate.id === schoolId,
  );
  const schoolName = school?.name ?? FALLBACK_TITLE;

  return (
    <>
      <title>
        {pageTitle ? `${pageTitle}${TITLE_SEPARATOR}${schoolName}` : schoolName}
      </title>
      <SchoolIcons school={school} />
      <link rel="manifest" href={schoolManifestHref(schoolId)} />
    </>
  );
}

function SchoolIcons({ school }: { school?: MySchoolDto }) {
  if (school?.logoS3Key) {
    return (
      <>
        <link rel="icon" type="image/png" sizes="192x192" href={schoolIconHref(school.id, 192)} />
        <link rel="apple-touch-icon" href={schoolIconHref(school.id, 192)} />
      </>
    );
  }
  return (
    <>
      {DEFAULT_APP_ICONS.icon.map((icon) => (
        <link key={icon.url} rel="icon" href={icon.url} sizes={'sizes' in icon ? icon.sizes : undefined} type={'type' in icon ? icon.type : undefined} />
      ))}
      <link rel="apple-touch-icon" href={DEFAULT_APP_ICONS.apple} />
    </>
  );
}
