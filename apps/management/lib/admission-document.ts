'use client';

import type { AdmissionDto } from '@campuspilot/api/routers/school/admission/admission.dto';
import { env } from '@campuspilot/env/management.client';

function documentUrl(schoolId: string, admissionId: string, suffix: string) {
  return new URL(`/api/blob/schools/${encodeURIComponent(schoolId)}/admissions/${encodeURIComponent(admissionId)}/documents/${suffix}`, env.NEXT_PUBLIC_SERVER_URL).toString();
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as { message?: string } | null;
  return new Error(body?.message ?? `Document request failed (${response.status}).`);
}

export function admissionDocumentDownloadUrl(schoolId: string, admissionId: string, fileId: string) {
  return documentUrl(schoolId, admissionId, encodeURIComponent(fileId));
}

export function uploadAdmissionDocument(input: { schoolId: string; admissionId: string; value: string; label?: string; file: File; onProgress: (progress: number) => void }) {
  return new Promise<AdmissionDto>((resolve, reject) => {
    const suffix = `${encodeURIComponent(input.value)}${input.label ? `?label=${encodeURIComponent(input.label)}` : ''}`;
    const request = new XMLHttpRequest();
    request.open('POST', documentUrl(input.schoolId, input.admissionId, suffix));
    request.withCredentials = true;
    request.responseType = 'json';
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error('Unable to reach the document service.'));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve(request.response as AdmissionDto);
      else reject(new Error((request.response as { message?: string } | null)?.message ?? `Document upload failed (${request.status}).`));
    };
    const formData = new FormData();
    formData.set('document', input.file);
    request.send(formData);
  });
}

export async function deleteAdmissionDocument(schoolId: string, admissionId: string, fileId: string) {
  const response = await fetch(documentUrl(schoolId, admissionId, encodeURIComponent(fileId)), { method: 'DELETE', credentials: 'include' });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<AdmissionDto>;
}
