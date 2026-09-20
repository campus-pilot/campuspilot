import { PutObjectCommand } from '@aws-sdk/client-s3';
import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { Context } from '../../../context';
import { rpcError, rpcErrorResponse } from '../../../errors';
import { parseImageUpload } from '../../../files/image-upload';
import { assertPermission } from '../../../permissions/authorization';
import {
  MAX_SCHOOL_LOGO_BYTES,
  SCHOOL_LOGO_FIELD_NAME,
} from './school.constants';
import { schoolDtoSchema, toSchoolDto } from './school.dto';

type HttpErrorReporter = (error: unknown) => void;

/** A Web Request/Response handler with no dependency on Hono or another framework. */
export async function handleSchoolLogoUpload(
  request: Request,
  context: Context,
  schoolId: string,
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    if (!schoolId) throw rpcError.badRequest('A school id is required.');
    await assertPermission(context, {
      action: SCHOOL_ACTIONS.UPDATE_LOGO,
      resource: { kind: 'school', schoolId },
    });

    const [existingSchool] = await context.db
      .select({ id: schoolTable.id })
      .from(schoolTable)
      .where(eq(schoolTable.id, schoolId))
      .limit(1);
    if (!existingSchool) throw rpcError.notFound('School');

    const image = await parseImageUpload(request, {
      fieldName: SCHOOL_LOGO_FIELD_NAME,
      maxBytes: MAX_SCHOOL_LOGO_BYTES,
      subject: 'school logo',
    });
    const logoS3Key = `schools/${schoolId}/logo/${randomUUID()}.${image.extension}`;

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: logoS3Key,
        Body: image.bytes,
        ContentLength: image.bytes.byteLength,
        ContentType: image.contentType,
      }),
    );

    const [school] = await context.db
      .update(schoolTable)
      .set({ logoS3Key, updatedAt: new Date() })
      .where(eq(schoolTable.id, schoolId))
      .returning();
    if (!school) throw rpcError.notFound('School');

    // TODO: Schedule a durable workflow to delete the outdated logo object
    // after its replacement has been committed successfully.

    const dto = schoolDtoSchema.parse(toSchoolDto(school));
    return Response.json(dto);
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}
