import { PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@campuspilot/env/server';
import {
  hasExpectedImageSignature,
  IMAGE_EXTENSIONS_BY_MIME_TYPE,
  isSupportedImageMimeType,
} from '@campuspilot/s3/image';
import { getS3Client } from '@campuspilot/s3/client';
import { randomUUID } from 'node:crypto';

import { MAX_PROFILE_IMAGE_BYTES } from './profile-image.constants';

const MAX_GOOGLE_IMAGE_REDIRECTS = 3;

function isGoogleProfileImageUrl(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    (url.hostname === 'googleusercontent.com' ||
      url.hostname.endsWith('.googleusercontent.com'))
  );
}

async function fetchGoogleProfileImage(sourceUrl: string): Promise<Response> {
  let url = new URL(sourceUrl);

  for (let redirectCount = 0; ; redirectCount += 1) {
    if (!isGoogleProfileImageUrl(url)) {
      throw new TypeError('Google profile image URL has an untrusted host.');
    }

    const response = await fetch(url, { redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    if (redirectCount >= MAX_GOOGLE_IMAGE_REDIRECTS) {
      throw new TypeError('Google profile image redirected too many times.');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new TypeError('Google profile image redirect is invalid.');
    }
    url = new URL(location, url);
  }
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROFILE_IMAGE_BYTES
  ) {
    throw new RangeError('Google profile image exceeds the upload limit.');
  }

  if (!response.body) throw new TypeError('Google profile image has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_PROFILE_IMAGE_BYTES) {
      await reader.cancel();
      throw new RangeError('Google profile image exceeds the upload limit.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Copies a verified Google-hosted profile image into private CampusPilot S3
 * storage. The caller decides whether the returned immutable key should win
 * over an existing user-selected image.
 */
export async function importGoogleProfileImage(
  userId: string,
  sourceUrl: string,
): Promise<string> {
  const response = await fetchGoogleProfileImage(sourceUrl);
  if (!response.ok) {
    throw new TypeError(`Google profile image returned HTTP ${response.status}.`);
  }

  const contentType = response.headers
    .get('content-type')
    ?.split(';')[0]
    ?.trim();
  if (!contentType || !isSupportedImageMimeType(contentType)) {
    throw new TypeError('Google profile image has an unsupported format.');
  }

  const bytes = await readBoundedBody(response);
  if (!hasExpectedImageSignature(bytes, contentType)) {
    throw new TypeError('Google profile image bytes do not match its format.');
  }

  const extension = IMAGE_EXTENSIONS_BY_MIME_TYPE[contentType][0];
  const key = `users/${userId}/profile-image/${randomUUID()}.${extension}`;
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentLength: bytes.byteLength,
      ContentType: contentType,
    }),
  );
  return key;
}

/** Extracts Google's picture claim only after Better Auth accepted the token. */
export function googlePictureFromIdToken(idToken: string | null | undefined) {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { iss?: unknown; picture?: unknown };
    if (
      claims.iss !== 'https://accounts.google.com' &&
      claims.iss !== 'accounts.google.com'
    ) {
      return undefined;
    }
    return typeof claims.picture === 'string' ? claims.picture : undefined;
  } catch {
    return undefined;
  }
}
