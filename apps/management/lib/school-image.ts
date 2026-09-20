'use client';

import {
  schoolDetailsDtoSchema,
  type SchoolDetailsDto,
} from '@campuspilot/api/routers/school/school.dto';
import {
  MAX_SCHOOL_LOGO_BYTES,
  SCHOOL_LOGO_EXTENSIONS_BY_MIME_TYPE,
  SCHOOL_LOGO_FIELD_NAME,
  SCHOOL_LOGO_MIME_TYPES,
} from '@campuspilot/api/routers/system-admin/school/school.constants';
import { env } from '@campuspilot/env/management.client';

const MAX_LOGO_DIMENSION = 1_600;
const MIN_WEBP_QUALITY = 0.45;
const PREPARED_LOGO_MIME_TYPE = 'image/webp' as const;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('Unable to encode the school logo.')),
      PREPARED_LOGO_MIME_TYPE,
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

async function prepareSchoolLogo(file: File): Promise<File> {
  if (!SCHOOL_LOGO_MIME_TYPES.some((type) => type === file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }

  const image = await loadImage(file);
  const scale = Math.min(
    1,
    MAX_LOGO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const drawingContext = canvas.getContext('2d');
  if (!drawingContext) {
    throw new Error('Image processing is unavailable in this browser.');
  }
  drawingContext.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > MAX_SCHOOL_LOGO_BYTES && quality > MIN_WEBP_QUALITY) {
    quality = Math.max(MIN_WEBP_QUALITY, quality - 0.1);
    blob = await canvasToBlob(canvas, quality);
  }
  if (blob.size > MAX_SCHOOL_LOGO_BYTES) {
    throw new Error(
      'The logo could not be reduced below 5 MB. Choose a smaller image.',
    );
  }

  const preparedMimeType = SCHOOL_LOGO_MIME_TYPES.find(
    (mimeType) => mimeType === blob.type,
  );
  if (!preparedMimeType) {
    throw new Error('The browser returned an unsupported image format.');
  }
  const extension = SCHOOL_LOGO_EXTENSIONS_BY_MIME_TYPE[preparedMimeType][0];
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'school-logo';
  return new File([blob], `${baseName}.${extension}`, {
    type: preparedMimeType,
    lastModified: Date.now(),
  });
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
    const cleanUp = () =>
      options.signal?.removeEventListener('abort', handleAbort);

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

/** Compresses a logo locally, then uploads it through the permissioned blob endpoint. */
export async function uploadSchoolLogo(
  schoolId: string,
  source: File,
  options: SchoolLogoUploadOptions = {},
): Promise<SchoolDetailsDto> {
  options.signal?.throwIfAborted();
  const logo = await prepareSchoolLogo(source);
  options.signal?.throwIfAborted();
  const formData = new FormData();
  formData.set(SCHOOL_LOGO_FIELD_NAME, logo);

  const body = await uploadFormData(
    new URL(
      `/api/blob/schools/${encodeURIComponent(schoolId)}/logo`,
      env.NEXT_PUBLIC_SERVER_URL,
    ),
    formData,
    options,
  );
  return schoolDetailsDtoSchema.parse(body);
}
