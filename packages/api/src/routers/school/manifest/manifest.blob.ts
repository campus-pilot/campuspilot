import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Context } from '../../../context';
import { rpcError, rpcErrorResponse } from '../../../errors';
import { SCHOOL_LOGO_BLOB_SIZES } from '../logo/logo.blob';

/** Matches the management app's own manifest and `viewport.themeColor`. */
const MANAGEMENT_THEME_COLOR = '#c2580e';

/**
 * A renamed school shows up in installed apps within an hour. Browsers
 * re-check installed manifests on their own schedule, so a longer cache would
 * only delay that further.
 */
const SCHOOL_MANIFEST_CACHE_CONTROL = 'public, max-age=3600';

const schoolManifestInputSchema = z.object({ schoolId: z.string().min(1) });

type HttpErrorReporter = (error: unknown) => void;

/**
 * Serves the web-app manifest that installs one school as its own app:
 * `GET /blob/school/{schoolId}/manifest.webmanifest`.
 *
 * Public by design (see the root AGENTS.md on `/blob/*`): browsers fetch
 * manifests without the user's session. A school's name and logo are public
 * school details, so publishing them here is intended.
 *
 * The manifest lives on the API origin, but `start_url`, `scope` and `id`
 * point at the management app (`PUBLIC_APP_URL`), since an installed app must
 * open on the origin of the page that offered it. Each school gets its own
 * `id`, so Chrome installs every school as a separate app, apart from the
 * CampusPilot app (`id: '/'`). Icon URLs are relative and resolve against
 * this manifest's URL, which points them at the public logo blob.
 */
export async function handleSchoolManifestBlob(
  context: Pick<Context, 'db'>,
  input: { schoolId: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    const parsed = schoolManifestInputSchema.safeParse(input);
    if (!parsed.success) throw rpcError.badRequest('A school id is required.');
    const { schoolId } = parsed.data;

    const [school] = await context.db
      .select({ name: schoolTable.name, logoS3Key: schoolTable.logoS3Key })
      .from(schoolTable)
      .where(eq(schoolTable.id, schoolId))
      .limit(1);
    if (!school) throw rpcError.notFound('School');

    const schoolPath = `/school/${encodeURIComponent(schoolId)}`;
    const appUrl = (path: string) => new URL(path, env.PUBLIC_APP_URL).toString();
    const icons = school.logoS3Key
      ? SCHOOL_LOGO_BLOB_SIZES.map((size) => ({
          src: `logo?size=${size}`,
          sizes: `${size}x${size}`,
          type: 'image/png',
        }))
      : [192, 512].map((size) => ({
          src: appUrl(`/app-icon-${size}.png`),
          sizes: `${size}x${size}`,
          type: 'image/png',
        }));

    const manifest = {
      id: appUrl(schoolPath),
      name: school.name,
      short_name: school.name,
      description: `${school.name} on CampusPilot.`,
      start_url: appUrl(schoolPath),
      scope: appUrl(schoolPath),
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: MANAGEMENT_THEME_COLOR,
      categories: ['business', 'education', 'productivity'],
      icons,
    };

    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': SCHOOL_MANIFEST_CACHE_CONTROL,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}
