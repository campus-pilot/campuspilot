'use client';

import { schoolDtoSchema, type SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
import {
  MAX_SCHOOL_LOGO_BYTES,
  SCHOOL_LOGO_FIELD_NAME,
} from '@campuspilot/api/routers/system-admin/school/school.constants';
import { env } from '@campuspilot/env/admin.client';

const MAX_LOGO_DIMENSION = 1_600;
const MIN_WEBP_QUALITY = 0.45;

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

export async function uploadSchoolLogo(schoolId: string, source: File): Promise<SchoolDto> {
  const logo = await prepareSchoolLogo(source);
  const formData = new FormData();
  formData.set(SCHOOL_LOGO_FIELD_NAME, logo);

  const response = await fetch(
    new URL(`/api/system-admin/schools/${encodeURIComponent(schoolId)}/logo`, env.NEXT_PUBLIC_SERVER_URL),
    { method: 'POST', body: formData, credentials: 'include' },
  );

  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String(body.message)
        : 'Unable to upload the school logo.';
    throw new Error(message);
  }

  return schoolDtoSchema.parse(body);
}
