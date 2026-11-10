import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { co } from '../../cadet/procedure';
import { rpcError, toRpcError } from '../../errors';

/** Characters a student must type before the sign-in page asks for schools. */
export const CADET_SCHOOL_SEARCH_MIN_LENGTH = 3;

/** Schools returned per search; the sign-in combobox shows all of them. */
export const CADET_SCHOOL_SEARCH_LIMIT = 5;

export const searchCadetSchoolsInputSchema = z.object({
  query: z.string().trim().min(CADET_SCHOOL_SEARCH_MIN_LENGTH).max(100),
});

/** Only the public school details a student needs to pick their school. */
export const cadetSchoolOptionSchema = z.object({
  /** The school code the admission sign-in takes (`school.slug`). */
  slug: z.string(),
  name: z.string(),
  /** Short-lived presigned logo URL, or null when the school has no logo. */
  logoUrl: z.string().nullable(),
});

export type CadetSchoolOption = z.infer<typeof cadetSchoolOptionSchema>;

export const getCadetSignInSchoolInputSchema = z.object({
  slug: z.string().trim().min(1).max(100),
});

/** Lifetime of the sign-in page's logo URLs; the page refetches before it ends. */
const SIGN_IN_LOGO_URL_TTL_SECONDS = 5 * 60;

/**
 * Logos on the sign-in page are in-page images, so they are short-lived
 * presigned URLs rather than the never-expiring `/blob` icon (see AGENTS.md).
 * Presigning is a local signature, so signing one per suggestion is cheap.
 */
async function signInLogoUrl(logoS3Key: string | null) {
  if (!logoS3Key) return null;
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: logoS3Key,
      ResponseCacheControl: 'private, no-store',
    }),
    { expiresIn: SIGN_IN_LOGO_URL_TTL_SECONDS },
  );
}

async function toSchoolOption(school: { slug: string; name: string; logoS3Key: string | null }): Promise<CadetSchoolOption> {
  return { slug: school.slug, name: school.name, logoUrl: await signInLogoUrl(school.logoS3Key) };
}

/** Escapes `%`, `_` and `\` so the query matches literally inside ILIKE. */
function likeLiteral(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Public procedures of the Cadet Portal: built on `co` without
 * `cadetProcedure`, so they answer anonymous callers on the sign-in page.
 * They may only return public school details (name and school code).
 */
export const cadetSchoolSearchRouter = {
  searchSchools: co
    .route({
      summary: 'Search schools for sign-in',
      description:
        'Find up to five schools by name or school code for the Cadet Portal sign-in page. Public: no sign-in required.',
      tags: ['Cadet'],
    })
    .meta({
      // Sign-in page only; a connected app is already signed in to one school.
      mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'account' },
    })
    .input(searchCadetSchoolsInputSchema)
    .output(z.object({ schools: z.array(cadetSchoolOptionSchema) }))
    /**
     * Matches the name or school code anywhere, case-insensitively. Ranking:
     * exact school code, then names or codes starting with the query, then
     * the rest, each by name.
     *
     * Demo schools (`is_demo`) are sandboxes, so they are left out of
     * suggestions and only returned when the query is their exact school
     * code; that keeps a demo usable without listing every demo publicly.
     */
    .handler(async ({ context, input }) => {
      try {
        const query = input.query.toLowerCase();
        const contains = `%${likeLiteral(query)}%`;
        const prefix = `${likeLiteral(query)}%`;
        const exactSlug = eq(sql`lower(${schoolTable.slug})`, query);
        const schools = await context.db
          .select({ slug: schoolTable.slug, name: schoolTable.name, logoS3Key: schoolTable.logoS3Key })
          .from(schoolTable)
          .where(
            or(
              exactSlug,
              and(
                eq(schoolTable.isDemo, false),
                or(ilike(schoolTable.name, contains), ilike(schoolTable.slug, contains)),
              ),
            ),
          )
          .orderBy(
            sql`case when ${exactSlug} then 0 when ${schoolTable.name} ilike ${prefix} or ${schoolTable.slug} ilike ${prefix} then 1 else 2 end`,
            asc(schoolTable.name),
            asc(schoolTable.slug),
          )
          .limit(CADET_SCHOOL_SEARCH_LIMIT);
        return { schools: await Promise.all(schools.map(toSchoolOption)) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getSignInSchool: co
    .route({
      summary: 'Get a school for sign-in',
      description:
        'Get the name and logo of the school with this exact school code, for the Cadet Portal sign-in page. Public: no sign-in required.',
      tags: ['Cadet'],
    })
    .meta({
      mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'account' },
    })
    .input(getCadetSignInSchoolInputSchema)
    .output(cadetSchoolOptionSchema)
    /**
     * Looks the code up exactly (case-insensitively), demo schools included,
     * like `searchSchools` does for an exact code. It backs both a shared
     * `?school=<code>` sign-in link and the header shown once a school is
     * picked.
     */
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .select({ slug: schoolTable.slug, name: schoolTable.name, logoS3Key: schoolTable.logoS3Key })
          .from(schoolTable)
          .where(eq(sql`lower(${schoolTable.slug})`, input.slug.toLowerCase()))
          .limit(1);
        if (!school) throw rpcError.notFound('School');
        return await toSchoolOption(school);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
