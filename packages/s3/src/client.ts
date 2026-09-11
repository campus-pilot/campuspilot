import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { env } from '@campuspilot/env/server';

let s3Client: S3Client | undefined;

const getCredentials = (): S3ClientConfig['credentials'] => {
  if (!env.S3_ACCESS_KEY_ID && !env.S3_SECRET_ACCESS_KEY) return undefined;

  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error(
      'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be provided together',
    );
  }

  return {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  };
};

export const createS3Client = (): S3Client =>
  new S3Client({
    credentials: getCredentials(),
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    region: env.S3_REGION,
  });

export const getS3Client = (): S3Client => {
  s3Client ??= createS3Client();

  return s3Client;
};
