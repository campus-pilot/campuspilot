import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Context } from '../../../context';
import { rpcError, rpcErrorResponse } from '../../../errors';
import { isSchoolFeatureEnabled } from '../../../feature-flags/feature-flags.service';
import { SCHOOL_LOGO_BLOB_SIZES } from '../logo/logo.blob';

/** Matches the Cadet Portal's `viewport.themeColor`. */
const CADET_THEME_COLOR = '#c2580e';
/** Same reasoning as the management school manifest: renames show within an hour. */
const CADET_MANIFEST_CACHE_CONTROL = 'public, max-age=3600';
/** Reuse the open app window for captured links (see the management manifest). */
const CADET_LAUNCH_HANDLER = { client_mode: ['navigate-existing', 'auto'] };

const cadetManifestInputSchema = z.object({ schoolId: z.string().min(1) });

type HttpErrorReporter = (error: unknown) => void;

/**
 * Serves the web-app manifest that installs a school's Cadet Portal as its
 * own app: `GET /blob/school/{schoolId}/cadet.webmanifest` (D-17, Phase 3).
 *
 * Public by design, like the management school manifest (root AGENTS.md on
 * `/blob/*`): it only publishes the school's name and logo, which are public
 * school details.
 *
 * The Cadet Portal is one origin for every school and its routes carry no
 * school, so the scope and start URL are the whole portal; only the app
 * `id` is per school (`/?school={id}`), so a family with children in two
 * schools can install each school's portal as a separate app. The portal
 * links this manifest only on signed-in pages, where the school is known
 * from the session; before sign-in it offers no manifest at all. Icon URLs
 * are relative to this manifest (the public logo blob); without a logo the
 * portal's own CampusPilot icons are used.
 *
 * A school whose `cadet` feature is disabled has no portal to install, so it
 * answers 404 exactly like an unknown school; this public route therefore
 * does not reveal which schools have the feature.
 */
export async function handleCadetManifestBlob(
  context: Pick<Context, 'db'>,
  input: { schoolId: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    const parsed = cadetManifestInputSchema.safeParse(input);
    if (!parsed.success) throw rpcError.badRequest('A school id is required.');
    const { schoolId } = parsed.data;

    const [school] = await context.db
      .select({ name: schoolTable.name, logoS3Key: schoolTable.logoS3Key })
      .from(schoolTable)
      .where(eq(schoolTable.id, schoolId))
      .limit(1);
    if (!school) throw rpcError.notFound('School');
    if (!(await isSchoolFeatureEnabled(context.db, schoolId, 'cadet'))) {
      throw rpcError.notFound('School');
    }

    const cadetUrl = (path: string) => new URL(path, env.CADET_APP_URL).toString();
    const icons = school.logoS3Key
      ? SCHOOL_LOGO_BLOB_SIZES.map((size) => ({ src: `logo?size=${size}`, sizes: `${size}x${size}`, type: 'image/png' }))
      : [192, 512].map((size) => ({ src: cadetUrl(`/app-icon-${size}.png`), sizes: `${size}x${size}`, type: 'image/png' }));

    const manifest = {
      id: cadetUrl(`/?school=${encodeURIComponent(schoolId)}`),
      name: `${school.name} Cadet Portal`,
      short_name: school.name,
      description: `The Cadet Portal of ${school.name} on CampusPilot.`,
      start_url: cadetUrl('/'),
      scope: cadetUrl('/'),
      display: 'standalone',
      launch_handler: CADET_LAUNCH_HANDLER,
      background_color: '#ffffff',
      theme_color: CADET_THEME_COLOR,
      categories: ['education'],
      icons,
    };

    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': CADET_MANIFEST_CACHE_CONTROL,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}
