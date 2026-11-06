import { GetObjectCommand } from '@aws-sdk/client-s3';
import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';

import type { Context } from '../../../context';
import { rpcError, rpcErrorResponse } from '../../../errors';

/**
 * The only square edge lengths the public logo blob renders. They match the
 * 192px and 512px icons browsers require for favicons and installed web apps.
 * Arbitrary sizes are refused so callers cannot make the server resize to
 * unbounded dimensions.
 */
export const SCHOOL_LOGO_BLOB_SIZES = ['192', '512'] as const;

/**
 * Browsers and CDNs may reuse a rendered logo for an hour. The URL is stable
 * across logo replacements, so it cannot be cached as immutable; the ETag
 * lets revalidation skip the download and resize when the logo is unchanged.
 */
const SCHOOL_LOGO_BLOB_CACHE_CONTROL = 'public, max-age=3600';

const schoolLogoBlobInputSchema = z.object({
  schoolId: z.string().min(1),
  size: z.enum(SCHOOL_LOGO_BLOB_SIZES),
});

type HttpErrorReporter = (error: unknown) => void;

/** Identifies one rendering of one stored logo without exposing its S3 key. */
function logoEntityTag(logoS3Key: string, size: string) {
  const digest = createHash('sha256').update(logoS3Key).digest('base64url');
  return `"${digest.slice(0, 22)}-${size}"`;
}

/**
 * Serves a school's logo as a square, transparent-padded PNG at a stable URL
 * that never expires: `GET /blob/school/{schoolId}/logo?size=192|512`.
 *
 * This is deliberately public, with no session or permission check, because
 * browsers fetch favicons and installed-app icons in the background without
 * credentials and keep the URL for later refreshes. A short-lived presigned
 * URL (as `school.getLogo` returns) would break those icons once it expired.
 * Only the logo is published this way; every other school file stays behind
 * permissioned, expiring URLs.
 *
 * Use it for browser icons only (favicon, manifest and apple-touch icons).
 * Logos rendered inside pages keep using `school.getLogo`, so in-app images
 * do not depend on this public, cacheable URL.
 */
export async function handleSchoolLogoBlob(
  context: Pick<Context, 'db'>,
  input: { schoolId: string; size: string | undefined },
  request: Request,
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    const parsed = schoolLogoBlobInputSchema.safeParse(input);
    if (!parsed.success) {
      throw rpcError.badRequest(
        `A logo size of ${SCHOOL_LOGO_BLOB_SIZES.join(' or ')} is required.`,
      );
    }
    const { schoolId, size } = parsed.data;

    const [school] = await context.db
      .select({ logoS3Key: schoolTable.logoS3Key })
      .from(schoolTable)
      .where(eq(schoolTable.id, schoolId))
      .limit(1);
    if (!school) throw rpcError.notFound('School');
    if (!school.logoS3Key) throw rpcError.notFound('School logo');

    const entityTag = logoEntityTag(school.logoS3Key, size);
    const cacheHeaders = {
      'Cache-Control': SCHOOL_LOGO_BLOB_CACHE_CONTROL,
      ETag: entityTag,
    };
    if (request.headers.get('if-none-match') === entityTag) {
      return new Response(null, { status: 304, headers: cacheHeaders });
    }

    const stored = await getS3Client().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: school.logoS3Key }),
    );
    if (!stored.Body) throw rpcError.notFound('School logo');
    const edge = Number(size);
    const png = await sharp(await stored.Body.transformToByteArray())
      .resize(edge, edge, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        ...cacheHeaders,
        'Content-Type': 'image/png',
        'Content-Length': String(png.byteLength),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}
