import { z } from 'zod';

export const S3_ENV_SHAPE = {
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1),
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  S3_REGION: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
};
