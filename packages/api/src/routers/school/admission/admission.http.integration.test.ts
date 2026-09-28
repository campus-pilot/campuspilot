import { GetObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { MAX_ADMISSION_DOCUMENT_SIZE_BYTES } from '@campuspilot/db/schema/jsonb/admission-config';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { describe, expect, it } from 'vitest';

import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestSchool,
} from '../../../../test/fixtures';
import {
  handleAdmissionDocumentDelete,
  handleAdmissionDocumentRead,
  handleAdmissionDocumentUpload,
  handleAdmissionPhotoRead,
  handleAdmissionPhotoUpload,
} from './admission.http';

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function uploadRequest(bytes: string | Uint8Array<ArrayBuffer>, fileName: string, type = 'application/pdf') {
  const formData = new FormData();
  formData.set('document', new Blob([bytes], { type }), fileName);
  return new Request('http://localhost/document', { method: 'POST', body: formData });
}

function photoRequest() {
  const formData = new FormData();
  formData.set('photo', new Blob([Uint8Array.from(VALID_PNG_BYTES)], { type: 'image/png' }), 'student.png');
  return new Request('http://localhost/photo', { method: 'POST', body: formData });
}

describe('admission document HTTP handlers', () => {
  it('keeps multiple immutable files under one document type and supports permissioned download and deletion', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const manager = await createSchoolStaffSession(school.id, [{ role: 'manager', meta: null }]);
    const teacher = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]);
    const context = { db, headers: new Headers(), session: manager.session };
    const baseInput = { schoolId: school.id, admissionId: admission.id, documentValue: 'aadhaar-card' };

    const firstResponse = await handleAdmissionDocumentUpload(
      uploadRequest('%PDF-1.7 front', 'aadhaar-front.pdf'),
      context,
      baseInput,
    );
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as typeof admission;
    expect(first.documents).toMatchObject([{ value: 'aadhaar-card', files: [{ fileName: 'aadhaar-front.pdf' }] }]);

    const secondResponse = await handleAdmissionDocumentUpload(
      uploadRequest('%PDF-1.7 back', 'aadhaar-back.pdf'),
      context,
      baseInput,
    );
    const second = await secondResponse.json() as typeof first;
    expect(second.documents).toHaveLength(1);
    expect(second.documents[0]!.files).toHaveLength(2);

    for (let index = 2; index < 10; index += 1) {
      const response = await handleAdmissionDocumentUpload(
        uploadRequest(`file-${index}`, `aadhaar-${index}.pdf`),
        context,
        baseInput,
      );
      expect(response.status).toBe(200);
    }
    const overTypeLimit = await handleAdmissionDocumentUpload(
      uploadRequest('eleventh', 'aadhaar-11.pdf'),
      context,
      baseInput,
    );
    expect(overTypeLimit.status).toBe(400);

    const file = second.documents[0]!.files[0]!;
    const stored = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: file.s3Key }));
    expect(Buffer.from(await stored.Body!.transformToByteArray()).toString()).toBe('%PDF-1.7 front');

    const readResponse = await handleAdmissionDocumentRead(
      { db, headers: new Headers(), session: teacher.session },
      { schoolId: school.id, admissionId: admission.id, fileId: file.id },
    );
    expect(readResponse.status).toBe(302);
    expect(readResponse.headers.get('location')).toContain('response-content-disposition');

    const deleteResponse = await handleAdmissionDocumentDelete(
      context,
      { schoolId: school.id, admissionId: admission.id, fileId: file.id },
    );
    expect(deleteResponse.status).toBe(200);
    const afterDelete = await deleteResponse.json() as typeof second;
    expect(afterDelete.documents[0]!.files).toHaveLength(9);
  });

  it('allows ten document types and rejects an eleventh type', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    const context = { db, headers: new Headers(), session: principal.session };
    for (let index = 0; index < 10; index += 1) {
      const response = await handleAdmissionDocumentUpload(
        uploadRequest(`document-${index}`, `document-${index}.txt`, 'text/plain'),
        context,
        { schoolId: school.id, admissionId: admission.id, documentValue: `type-${index}` },
      );
      expect(response.status).toBe(200);
    }
    const rejected = await handleAdmissionDocumentUpload(
      uploadRequest('extra', 'extra.txt', 'text/plain'),
      context,
      { schoolId: school.id, admissionId: admission.id, documentValue: 'type-10' },
    );
    expect(rejected.status).toBe(400);
  });

  it('uploads and reads a private student photo while blocking inactive admissions', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const inactiveAdmission = await createTestAdmission({ schoolId: school.id, registered: false });
    const manager = await createSchoolStaffSession(school.id, [{ role: 'manager', meta: null }]);
    const teacher = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]);
    const context = { db, headers: new Headers(), session: manager.session };
    const anonymous = await handleAdmissionPhotoUpload(
      photoRequest(),
      { db, headers: new Headers(), session: null },
      { schoolId: school.id, admissionId: admission.id },
    );
    expect(anonymous.status).toBe(401);
    const denied = await handleAdmissionPhotoUpload(
      photoRequest(),
      { db, headers: new Headers(), session: teacher.session },
      { schoolId: school.id, admissionId: admission.id },
    );
    expect(denied.status).toBe(403);
    const response = await handleAdmissionPhotoUpload(
      photoRequest(),
      context,
      { schoolId: school.id, admissionId: admission.id },
    );
    expect(response.status).toBe(200);
    const updated = await response.json() as typeof admission;
    expect(updated.photoS3Key).toMatch(new RegExp(`^schools/${school.id}/admissions/${admission.id}/photo/[0-9a-f-]+\\.png$`));
    const stored = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: updated.photoS3Key! }));
    expect(Buffer.from(await stored.Body!.transformToByteArray())).toEqual(VALID_PNG_BYTES);

    const read = await handleAdmissionPhotoRead(
      { db, headers: new Headers(), session: teacher.session },
      { schoolId: school.id, admissionId: admission.id },
    );
    expect(read.status).toBe(302);
    expect(read.headers.get('location')).toContain('X-Amz-Signature=');

    const inactiveUpload = await handleAdmissionPhotoUpload(
      photoRequest(),
      context,
      { schoolId: school.id, admissionId: inactiveAdmission.id },
    );
    expect(inactiveUpload.status).toBe(400);
  });

  it('rejects oversized files and admission mutations from read-only roles', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const teacher = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]);
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    const input = { schoolId: school.id, admissionId: admission.id, documentValue: 'other' };

    const denied = await handleAdmissionDocumentUpload(
      uploadRequest('notes', 'notes.txt', 'text/plain'),
      { db, headers: new Headers(), session: teacher.session },
      input,
    );
    expect(denied.status).toBe(403);

    const oversized = await handleAdmissionDocumentUpload(
      uploadRequest(new Uint8Array(MAX_ADMISSION_DOCUMENT_SIZE_BYTES + 1), 'large.bin', 'application/octet-stream'),
      { db, headers: new Headers(), session: principal.session },
      input,
    );
    expect(oversized.status).toBe(413);
  });
});
