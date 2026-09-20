import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_IMAGE_FIELD_NAME,
} from '@campuspilot/auth/profile-image.constants';
import { user } from '@campuspilot/db/schema/auth';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { Context } from '../../context';
import { rpcError, rpcErrorResponse } from '../../errors';
import { parseImageUpload } from '../../files/image-upload';
import { profileImageOutputSchema } from './profile-image.dto';
import { createProfileImageUrl } from './profile-image';

type HttpErrorReporter = (error: unknown) => void;

/** Uploads the authenticated user's profile image without coupling to Hono. */
export async function handleProfileImageUpload(
  request: Request,
  context: Context,
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    const userId = context.session?.user.id;
    if (!userId) throw rpcError.unauthorized();

    const image = await parseImageUpload(request, {
      fieldName: PROFILE_IMAGE_FIELD_NAME,
      maxBytes: MAX_PROFILE_IMAGE_BYTES,
      subject: 'profile image',
    });
    const profileImageS3Key =
      `users/${userId}/profile-image/${randomUUID()}.${image.extension}`;

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: profileImageS3Key,
        Body: image.bytes,
        ContentLength: image.bytes.byteLength,
        ContentType: image.contentType,
      }),
    );

    const [updatedUser] = await context.db
      .update(user)
      .set({ profileImageS3Key, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning({ profileImageS3Key: user.profileImageS3Key });
    if (!updatedUser) throw rpcError.notFound('User');

    // Old immutable objects are retained until a durable cleanup workflow runs.
    const body = profileImageOutputSchema.parse({
      profileImageS3Key: updatedUser.profileImageS3Key,
    });
    return Response.json(body, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}

/** Redirects an authenticated image request to a short-lived private S3 URL. */
export async function handleProfileImageRead(
  context: Context,
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    const userId = context.session?.user.id;
    if (!userId) throw rpcError.unauthorized();

    const [account] = await context.db
      .select({ profileImageS3Key: user.profileImageS3Key })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!account) throw rpcError.notFound('User');
    if (!account.profileImageS3Key) {
      throw rpcError.notFound('Profile image');
    }

    const url = await createProfileImageUrl(account.profileImageS3Key);
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}
