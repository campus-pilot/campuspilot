'use client';

import {
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_IMAGE_FIELD_NAME,
} from './profile-image.constants';

const MIN_WEBP_QUALITY = 0.45;
const PROFILE_IMAGE_MAX_DIMENSION = 1_600;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('Unable to encode the profile image.')),
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

/** Uses the same browser-side resizing and quality loop as school logos. */
async function prepareProfileImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }

  const image = await loadImage(file);
  const scale = Math.min(
    1,
    PROFILE_IMAGE_MAX_DIMENSION /
      Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Image processing is unavailable in this browser.');
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > MAX_PROFILE_IMAGE_BYTES && quality > MIN_WEBP_QUALITY) {
    quality = Math.max(MIN_WEBP_QUALITY, quality - 0.1);
    blob = await canvasToBlob(canvas, quality);
  }
  if (blob.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error(
      'The profile image could not be reduced below 5 MB. Choose a smaller image.',
    );
  }
  if (blob.type !== 'image/webp') {
    throw new Error('The browser returned an unsupported image format.');
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'profile-image';
  return new File([blob], `${baseName}.webp`, {
    type: blob.type,
    lastModified: Date.now(),
  });
}

export type ProfileImageUploadResult = {
  profileImageS3Key: string;
};

export type ProfileImageUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (percentage: number) => void;
};

/**
 * Builds the authenticated image endpoint from the profile key already carried
 * by the Better Auth session. The key is only a cache-busting version marker;
 * the server always resolves the authenticated user's current image itself.
 */
export function getProfileImageUrl(
  serverUrl: string,
  profileImageS3Key: string | null | undefined,
) {
  if (!profileImageS3Key) return undefined;
  const url = new URL('/api/blob/users/me/profile-image', serverUrl);
  url.searchParams.set('version', profileImageS3Key);
  return url.toString();
}

function parseUploadResult(value: unknown): ProfileImageUploadResult {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('profileImageS3Key' in value) ||
    typeof value.profileImageS3Key !== 'string'
  ) {
    throw new TypeError(
      'The profile image upload returned an invalid response.',
    );
  }
  return { profileImageS3Key: value.profileImageS3Key };
}

function uploadFormData(
  url: URL,
  formData: FormData,
  options: ProfileImageUploadOptions,
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
          : 'Unable to upload the profile image.';
      reject(new Error(message));
    });
    request.addEventListener('error', () => {
      cleanUp();
      reject(new Error('Unable to upload the profile image.'));
    });
    request.addEventListener('abort', () => {
      cleanUp();
      reject(
        new DOMException('The profile image upload was cancelled.', 'AbortError'),
      );
    });

    if (options.signal?.aborted) {
      cleanUp();
      reject(
        new DOMException('The profile image upload was cancelled.', 'AbortError'),
      );
      return;
    }
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    request.send(formData);
  });
}

/** Prepares the image on canvas and uploads it with progress and cancellation. */
export async function uploadProfileImage(
  serverUrl: string,
  source: File,
  options: ProfileImageUploadOptions = {},
): Promise<ProfileImageUploadResult> {
  options.signal?.throwIfAborted();
  const image = await prepareProfileImage(source);
  options.signal?.throwIfAborted();

  const formData = new FormData();
  formData.set(PROFILE_IMAGE_FIELD_NAME, image);
  const body = await uploadFormData(
    new URL('/api/blob/users/me/profile-image', serverUrl),
    formData,
    options,
  );
  return parseUploadResult(body);
}
