import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { admissionTable } from '@campuspilot/db/schema/admission';
import {
  admissionDocumentsSchema,
  MAX_ADMISSION_DOCUMENT_TYPES,
  MAX_ADMISSION_FILES_PER_DOCUMENT,
  MAX_ADMISSION_DOCUMENT_SIZE_BYTES,
} from '@campuspilot/db/schema/jsonb/admission-config';
import { env } from '@campuspilot/env/server';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { getS3Client } from '@campuspilot/s3/client';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { Context } from '../../../context';
import { rpcError, rpcErrorResponse } from '../../../errors';
import { parseDocumentUpload } from '../../../files/document-upload';
import { parseImageUpload } from '../../../files/image-upload';
import { assertPermission } from '../../../permissions/authorization';
import {
  ADMISSION_PHOTO_FIELD_NAME,
  MAX_ADMISSION_PHOTO_BYTES,
} from './admission.constants';
import { toAdmissionDto } from './admission.dto';
import { assertAdmissionRegistered } from './admission-registration';

export const ADMISSION_DOCUMENT_FIELD_NAME = 'document';
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
type HttpErrorReporter = (error: unknown) => void;

function findFile(documents: typeof admissionTable.$inferSelect.documents, fileId: string) {
  for (const document of documents) {
    const file = document.files.find((candidate) => candidate.id === fileId);
    if (file) return file;
  }
  return undefined;
}

/** Uploads a private, immutable student photo for an active admission. */
export async function handleAdmissionPhotoUpload(
  request: Request,
  context: Context,
  input: { schoolId: string; admissionId: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    await assertPermission(context, {
      action: SCHOOL_ACTIONS.UPDATE_ADMISSION,
      resource: { kind: 'school', schoolId: input.schoolId },
    });
    await assertAdmissionRegistered(context.db, input);
    const photo = await parseImageUpload(request, {
      fieldName: ADMISSION_PHOTO_FIELD_NAME,
      maxBytes: MAX_ADMISSION_PHOTO_BYTES,
      subject: 'student photo',
    });
    const photoS3Key = `schools/${input.schoolId}/admissions/${input.admissionId}/photo/${randomUUID()}.${photo.extension}`;
    await getS3Client().send(new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: photoS3Key,
      Body: photo.bytes,
      ContentLength: photo.bytes.byteLength,
      ContentType: photo.contentType,
    }));
    const [updated] = await context.db
      .update(admissionTable)
      .set({ photoS3Key, updatedAt: new Date() })
      .where(and(eq(admissionTable.schoolId, input.schoolId), eq(admissionTable.id, input.admissionId), eq(admissionTable.registered, true)))
      .returning();
    if (!updated) {
      throw rpcError.badRequest('This admission is no longer registered with the school and cannot be changed.');
    }

    // Old immutable photo objects are retained until a durable cleanup workflow runs.
    return Response.json(toAdmissionDto(updated), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}

/** Redirects a permissioned request to the admission's current private photo. */
export async function handleAdmissionPhotoRead(
  context: Context,
  input: { schoolId: string; admissionId: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    await assertPermission(context, {
      action: SCHOOL_ACTIONS.READ_ADMISSION,
      resource: { kind: 'school', schoolId: input.schoolId },
    });
    const [admission] = await context.db
      .select({ photoS3Key: admissionTable.photoS3Key })
      .from(admissionTable)
      .where(and(eq(admissionTable.schoolId, input.schoolId), eq(admissionTable.id, input.admissionId)))
      .limit(1);
    if (!admission) throw rpcError.notFound('Admission');
    if (!admission.photoS3Key) throw rpcError.notFound('Admission photo');
    const url = await getSignedUrl(getS3Client(), new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: admission.photoS3Key,
      ResponseContentDisposition: 'inline',
      ResponseCacheControl: 'private, no-store',
    }), { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
    return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}

/** Adds one immutable file to an admission document group. */
export async function handleAdmissionDocumentUpload(
  request: Request,
  context: Context,
  input: { schoolId: string; admissionId: string; documentValue: string; documentLabel?: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    if (
      !input.schoolId ||
      !input.admissionId ||
      !input.documentValue.trim() ||
      input.documentValue.length > 100 ||
      (input.documentLabel?.trim().length ?? 0) > 200
    ) {
      throw rpcError.badRequest('School, admission, and document type are required.');
    }
    await assertPermission(context, {
      action: SCHOOL_ACTIONS.UPDATE_ADMISSION,
      resource: { kind: 'school', schoolId: input.schoolId },
    });
    const upload = await parseDocumentUpload(request, {
      fieldName: ADMISSION_DOCUMENT_FIELD_NAME,
      maxBytes: MAX_ADMISSION_DOCUMENT_SIZE_BYTES,
    });
    const fileId = randomUUID();
    const s3Key = `schools/${input.schoolId}/admissions/${input.admissionId}/documents/${fileId}`;

    const admission = await context.db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(admissionTable)
        .where(and(eq(admissionTable.schoolId, input.schoolId), eq(admissionTable.id, input.admissionId)))
        .limit(1)
        .for('update');
      if (!existing) throw rpcError.notFound('Admission');
      if (!existing.registered) {
        throw rpcError.badRequest('This admission is no longer registered with the school and cannot be changed.');
      }
      const existingGroup = existing.documents.find(({ value }) => value === input.documentValue);
      if (!existingGroup && existing.documents.length >= MAX_ADMISSION_DOCUMENT_TYPES) {
        throw rpcError.badRequest(`An admission can have at most ${MAX_ADMISSION_DOCUMENT_TYPES} document types.`);
      }
      if (existingGroup && existingGroup.files.length >= MAX_ADMISSION_FILES_PER_DOCUMENT) {
        throw rpcError.badRequest(`Each document type can contain at most ${MAX_ADMISSION_FILES_PER_DOCUMENT} files.`);
      }

      await getS3Client().send(new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: s3Key,
        Body: upload.bytes,
        ContentLength: upload.bytes.byteLength,
        ContentType: upload.contentType,
      }));

      const uploadedFile = {
        id: fileId,
        s3Key,
        fileName: upload.fileName,
        contentType: upload.contentType,
        sizeBytes: upload.bytes.byteLength,
        uploadedAt: new Date().toISOString(),
      };
      const documents = existing.documents.some(({ value }) => value === input.documentValue)
        ? existing.documents.map((document) => document.value === input.documentValue
            ? { ...document, files: [...document.files, uploadedFile] }
            : document)
        : [...existing.documents, {
            value: input.documentValue,
            ...(input.documentLabel?.trim() ? { label: input.documentLabel.trim() } : {}),
            files: [uploadedFile],
          }];
      const [updated] = await transaction
        .update(admissionTable)
        .set({ documents: admissionDocumentsSchema.parse(documents), updatedAt: new Date() })
        .where(and(eq(admissionTable.schoolId, input.schoolId), eq(admissionTable.id, input.admissionId)))
        .returning();
      if (!updated) throw rpcError.notFound('Admission');
      return updated;
    });

    return Response.json(toAdmissionDto(admission), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}

/** Redirects a permissioned request to a short-lived, attachment-only URL. */
export async function handleAdmissionDocumentRead(
  context: Context,
  input: { schoolId: string; admissionId: string; fileId: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    await assertPermission(context, {
      action: SCHOOL_ACTIONS.READ_ADMISSION,
      resource: { kind: 'school', schoolId: input.schoolId },
    });
    const [admission] = await context.db.select({ documents: admissionTable.documents })
      .from(admissionTable)
      .where(and(eq(admissionTable.schoolId, input.schoolId), eq(admissionTable.id, input.admissionId)))
      .limit(1);
    if (!admission) throw rpcError.notFound('Admission');
    const file = findFile(admission.documents, input.fileId);
    if (!file) throw rpcError.notFound('Admission document');
    const safeName = file.fileName.replace(/[\r\n"]/g, '_');
    const url = await getSignedUrl(getS3Client(), new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: file.s3Key,
      ResponseContentDisposition: `attachment; filename="${safeName}"`,
      ResponseContentType: file.contentType,
      ResponseCacheControl: 'private, no-store',
    }), { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
    return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}

/** Removes one file while retaining its document group when other files remain. */
export async function handleAdmissionDocumentDelete(
  context: Context,
  input: { schoolId: string; admissionId: string; fileId: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    await assertPermission(context, {
      action: SCHOOL_ACTIONS.UPDATE_ADMISSION,
      resource: { kind: 'school', schoolId: input.schoolId },
    });
    const result = await context.db.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(admissionTable)
        .where(and(eq(admissionTable.schoolId, input.schoolId), eq(admissionTable.id, input.admissionId)))
        .limit(1)
        .for('update');
      if (!existing) throw rpcError.notFound('Admission');
      if (!existing.registered) {
        throw rpcError.badRequest('This admission is no longer registered with the school and cannot be changed.');
      }
      const file = findFile(existing.documents, input.fileId);
      if (!file) throw rpcError.notFound('Admission document');
      const documents = existing.documents.flatMap((document) => {
        const files = document.files.filter(({ id }) => id !== input.fileId);
        return files.length > 0 ? [{ ...document, files }] : [];
      });
      const [updated] = await transaction.update(admissionTable)
        .set({ documents: admissionDocumentsSchema.parse(documents), updatedAt: new Date() })
        .where(and(eq(admissionTable.schoolId, input.schoolId), eq(admissionTable.id, input.admissionId)))
        .returning();
      if (!updated) throw rpcError.notFound('Admission');
      return { updated, s3Key: file.s3Key };
    });
    await getS3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: result.s3Key }));
    return Response.json(toAdmissionDto(result.updated), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}
