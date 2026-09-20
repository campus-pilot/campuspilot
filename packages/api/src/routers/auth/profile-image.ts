import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';

const PROFILE_IMAGE_URL_TTL_SECONDS = 5 * 60;

/** Creates a short-lived URL for a private profile image object. */
export async function createProfileImageUrl(
  profileImageS3Key: string,
): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: profileImageS3Key,
      ResponseCacheControl: 'private, no-store',
    }),
    { expiresIn: PROFILE_IMAGE_URL_TTL_SECONDS },
  );
}
