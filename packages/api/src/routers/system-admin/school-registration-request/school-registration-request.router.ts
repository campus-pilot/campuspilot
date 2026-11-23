import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { schoolRegistrationRequestTable } from '@campuspilot/db/schema/school-registration-request';
import { env } from '@campuspilot/env/server';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { getS3Client } from '@campuspilot/s3/client';
import { count, desc, eq, ilike, or, sql } from 'drizzle-orm';

import { rpcError, toRpcError } from '../../../errors';
import { platformAdminProcedure } from '../../../index';
import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../../../paginations';
import { requireSystemPermission } from '../../../permissions/system';
import {
  getSchoolRegistrationRequestMediaInputSchema,
  getSchoolRegistrationRequestMediaOutputSchema,
  listSchoolRegistrationRequestsInputSchema,
  listSchoolRegistrationRequestsOutputSchema,
} from './school-registration-request.dto';

/** Hidden from MCP: a school's contact details and recordings, for platform admins only. */
const MCP_META = { exposure: 'hidden', destructive: false, module: 'platform' } as const;

/** Answers the admin search matches, by key of the stored response. */
const SEARCHED_ANSWERS = ['schoolName', 'phone', 'email', 'address'] as const;

/** Presigned file URLs expire quickly; the admin dialog asks again when it reopens. */
const MEDIA_URL_TTL_SECONDS = 5 * 60;

/** Escapes `%`, `_` and `\` so a search term matches literally. */
function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function presign(key: string | null) {
  if (!key) return Promise.resolve(null);
  return getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ResponseCacheControl: 'private, no-store' }), {
    expiresIn: MEDIA_URL_TTL_SECONDS,
  });
}

/** Platform-admin view of School Onboarding form submissions (the admin app's School onboarding page). */
export const schoolRegistrationRequestRouter = {
  listSchoolRegistrationRequests: platformAdminProcedure
    .route({
      summary: 'List school onboarding submissions',
      description:
        'List the submissions of the website School Onboarding form, newest first, with their answers and which files they carry. Requires system-administrator permission.',
      tags: ['System Admin', 'Leads'],
    })
    .meta({ mcp: { ...MCP_META, access: 'read' } })
    .input(listSchoolRegistrationRequestsInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL_REGISTRATION_REQUESTS))
    .output(listSchoolRegistrationRequestsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const table = schoolRegistrationRequestTable;
        const pattern = likePattern(input.searchQuery);
        const where = input.searchQuery ? or(...SEARCHED_ANSWERS.map((key) => ilike(sql<string>`${table.response} ->> ${key}`, pattern))) : undefined;
        const [rows, totalRows] = await Promise.all([
          context.db.select().from(table).where(where).orderBy(desc(table.createdAt), desc(table.id)).limit(pageSize).offset(offset),
          context.db.select({ totalItems: count() }).from(table).where(where),
        ]);
        const items = rows.map((row) => ({
          id: row.id,
          formVersion: row.formVersion,
          response: row.response,
          logo: row.logoS3Key ? { contentType: row.logoContentType ?? 'application/octet-stream', bytes: row.logoBytes ?? 0 } : null,
          voiceNote: row.voiceNoteS3Key ? { contentType: row.voiceNoteContentType ?? 'application/octet-stream', bytes: row.voiceNoteBytes ?? 0 } : null,
          sourcePath: row.sourcePath,
          userAgent: row.userAgent,
          createdAt: row.createdAt,
        }));
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);
        return createPaginatedResult({ items, nextCursor: createNextPageCursor(currentPage, totalPages), currentPage, pageSize, totalItems, totalPages });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getSchoolRegistrationRequestMedia: platformAdminProcedure
    .route({
      summary: 'Get school onboarding files',
      description:
        'Create short-lived presigned URLs for the logo and voice note of one School Onboarding form submission. Requires system-administrator permission.',
      tags: ['System Admin', 'Leads', 'Files'],
    })
    .meta({ mcp: { ...MCP_META, access: 'read' } })
    .input(getSchoolRegistrationRequestMediaInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL_REGISTRATION_REQUESTS))
    .output(getSchoolRegistrationRequestMediaOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const [row] = await context.db
          .select({ logoS3Key: schoolRegistrationRequestTable.logoS3Key, voiceNoteS3Key: schoolRegistrationRequestTable.voiceNoteS3Key })
          .from(schoolRegistrationRequestTable)
          .where(eq(schoolRegistrationRequestTable.id, input.requestId))
          .limit(1);
        if (!row) throw rpcError.notFound('School registration request');
        const expiresAt = new Date(Date.now() + MEDIA_URL_TTL_SECONDS * 1000);
        const [logoUrl, voiceNoteUrl] = await Promise.all([presign(row.logoS3Key), presign(row.voiceNoteS3Key)]);
        return { logoUrl, voiceNoteUrl, expiresAt };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
