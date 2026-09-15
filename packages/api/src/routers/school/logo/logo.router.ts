import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';

import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSchoolPermission } from '../../../permissions/school';
import {
  getSchoolLogoInputSchema,
  getSchoolLogoOutputSchema,
} from './logo.dto';

const SCHOOL_LOGO_URL_TTL_SECONDS = 5 * 60;

export const schoolLogoRouter = {
  getLogo: protectedProcedure
    .route({
      summary: 'Get a school logo URL',
      description:
        'Create a short-lived presigned URL for previewing a private school logo. Requires permission to read the logo for that school.',
      tags: ['Schools', 'Files'],
    })
    .input(getSchoolLogoInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_LOGO))
    .output(getSchoolLogoOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .select({ logoS3Key: schoolTable.logoS3Key })
          .from(schoolTable)
          .where(eq(schoolTable.id, input.schoolId))
          .limit(1);
        if (!school) throw rpcError.notFound('School');
        if (!school.logoS3Key) throw rpcError.notFound('School logo');

        /**
         * The URL expires quickly because it grants direct access to a private
         * object; callers request a fresh URL through this permissioned route.
         */
        const url = await getSignedUrl(
          getS3Client(),
          new GetObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: school.logoS3Key,
            ResponseCacheControl: 'private, no-store',
          }),
          { expiresIn: SCHOOL_LOGO_URL_TTL_SECONDS },
        );

        return { url };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
