'use client';

import { z } from 'zod';
import { schoolDtoSchema, type SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
import {
  MAX_SCHOOL_LOGO_BYTES,
  SCHOOL_LOGO_FIELD_NAME,
} from '@campuspilot/api/routers/system-admin/school/school.constants';
import { env } from '@campuspilot/env/admin.client';

const MAX_LOGO_DIMENSION = 1_600;
const MIN_WEBP_QUALITY = 0.45;

/**
 * The logo endpoint is plain HTTP rather than oRPC, so JSON serialization turns
 * DTO dates into ISO strings. Coerce those transport values back to Dates
 * before exposing the response as a SchoolDto to the query cache.
 */
const schoolLogoResponseSchema = schoolDtoSchema.extend({
  createdAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date().nullable(),
});

export function getSchoolLogoUrl(
  school: Pick<SchoolDto, 'id' | 'logoS3Key'>,
  revision = 0,
): string | undefined {
  if (!school.logoS3Key) return undefined;

  const logoUrl = new URL(
    `/api/system-admin/schools/${encodeURIComponent(school.id)}/logo`,
    env.NEXT_PUBLIC_SERVER_URL,
  );
  if (revision > 0) logoUrl.searchParams.set('revision', String(revision));
  return logoUrl.toString();
}

/** Explicit client-side version used to refresh a replaced stable logo URL. */
export function schoolLogoRevisionQueryKey(schoolId: string) {
  return ['school-logo-revision', schoolId] as const;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Unable to encode the school logo.'))),
      'image/webp',
      quality,
    );
  });
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareSchoolLogo(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_LOGO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const drawingContext = canvas.getContext('2d');
  if (!drawingContext) throw new Error('Image processing is unavailable in this browser.');
  drawingContext.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > MAX_SCHOOL_LOGO_BYTES && quality > MIN_WEBP_QUALITY) {
    quality = Math.max(MIN_WEBP_QUALITY, quality - 0.1);
    blob = await canvasToBlob(canvas, quality);
  }

  if (blob.size > MAX_SCHOOL_LOGO_BYTES) {
    throw new Error('The logo could not be reduced below 5 MB. Choose a smaller image.');
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'school-logo';
  return new File([blob], `${baseName}.webp`, { type: blob.type, lastModified: Date.now() });
}

type SchoolLogoUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (percentage: number) => void;
};

function uploadFormData(
  url: URL,
  formData: FormData,
  options: SchoolLogoUploadOptions,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const handleAbort = () => request.abort();

    function cleanUp() {
      options.signal?.removeEventListener('abort', handleAbort);
    }

    request.open('POST', url);
    request.withCredentials = true;
    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.(
        Math.min(100, Math.round((event.loaded / event.total) * 100)),
      );
    });
    request.addEventListener('load', () => {
      cleanUp();
      let body: unknown;
      try {
        body = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        body = null;
      }

      if (request.status >= 200 && request.status < 300) {
        resolve(body);
        return;
      }

      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? String(body.message)
          : 'Unable to upload the school logo.';
      reject(new Error(message));
    });
    request.addEventListener('error', () => {
      cleanUp();
      reject(new Error('Unable to upload the school logo.'));
    });
    request.addEventListener('abort', () => {
      cleanUp();
      reject(new DOMException('The logo upload was cancelled.', 'AbortError'));
    });

    if (options.signal?.aborted) {
      cleanUp();
      reject(new DOMException('The logo upload was cancelled.', 'AbortError'));
      return;
    }
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    request.send(formData);
  });
}

/**
 * Compresses the source image in-browser, then uploads it with XHR so callers
 * can display real byte progress and cancel the request through an AbortSignal.
 */
export async function uploadSchoolLogo(
  schoolId: string,
  source: File,
  options: SchoolLogoUploadOptions = {},
): Promise<SchoolDto> {
  options.signal?.throwIfAborted();
  const logo = await prepareSchoolLogo(source);
  options.signal?.throwIfAborted();
  const formData = new FormData();
  formData.set(SCHOOL_LOGO_FIELD_NAME, logo);

  const body = await uploadFormData(
    new URL(`/api/system-admin/schools/${encodeURIComponent(schoolId)}/logo`, env.NEXT_PUBLIC_SERVER_URL),
    formData,
    options,
  );
  return schoolLogoResponseSchema.parse(body);
}
