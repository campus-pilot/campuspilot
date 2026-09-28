'use client';

import type { AdmissionDto } from '@campuspilot/api/routers/school/admission/admission.dto';
import {
  ADMISSION_PHOTO_FIELD_NAME,
  MAX_ADMISSION_PHOTO_BYTES,
} from '@campuspilot/api/routers/school/admission/admission.constants';
import type { ProfileImageUploadOptions } from '@campuspilot/auth/profile-image.client';
import { env } from '@campuspilot/env/management.client';

const MAX_DIMENSION = 1_600;
const MIN_WEBP_QUALITY = 0.45;

function photoUrl(schoolId: string, admissionId: string) {
  return new URL(
    `/api/blob/schools/${encodeURIComponent(schoolId)}/admissions/${encodeURIComponent(admissionId)}/photo`,
    env.NEXT_PUBLIC_SERVER_URL,
  );
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Unable to encode the student photo.')),
      'image/webp',
      quality,
    );
  });
}

async function preparePhoto(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.9;
    let blob = await canvasToBlob(canvas, quality);
    while (blob.size > MAX_ADMISSION_PHOTO_BYTES && quality > MIN_WEBP_QUALITY) {
      quality = Math.max(MIN_WEBP_QUALITY, quality - 0.1);
      blob = await canvasToBlob(canvas, quality);
    }
    if (blob.size > MAX_ADMISSION_PHOTO_BYTES) {
      throw new Error('The photo could not be reduced below 5 MB. Choose a smaller image.');
    }
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'student-photo'}.webp`, {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Uses the private blob endpoint and the S3 key only as a cache version. */
export function getAdmissionPhotoUrl(
  schoolId: string,
  admissionId: string,
  photoS3Key: string | null | undefined,
) {
  if (!photoS3Key) return undefined;
  const url = photoUrl(schoolId, admissionId);
  url.searchParams.set('version', photoS3Key);
  return url.toString();
}

/** Compresses a student photo locally before sending it to the private upload route. */
export async function uploadAdmissionPhoto(
  schoolId: string,
  admissionId: string,
  source: File,
  options: ProfileImageUploadOptions = {},
) {
  options.signal?.throwIfAborted();
  const photo = await preparePhoto(source);
  options.signal?.throwIfAborted();
  const formData = new FormData();
  formData.set(ADMISSION_PHOTO_FIELD_NAME, photo);

  return new Promise<AdmissionDto>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const handleAbort = () => request.abort();
    const cleanUp = () => options.signal?.removeEventListener('abort', handleAbort);
    request.open('POST', photoUrl(schoolId, admissionId));
    request.withCredentials = true;
    request.responseType = 'json';
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onerror = () => {
      cleanUp();
      reject(new Error('Unable to reach the student photo service.'));
    };
    request.onabort = () => {
      cleanUp();
      reject(new DOMException('The student photo upload was cancelled.', 'AbortError'));
    };
    request.onload = () => {
      cleanUp();
      if (request.status >= 200 && request.status < 300) resolve(request.response as AdmissionDto);
      else reject(new Error((request.response as { message?: string } | null)?.message ?? `Photo upload failed (${request.status}).`));
    };
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    request.send(formData);
  });
}
