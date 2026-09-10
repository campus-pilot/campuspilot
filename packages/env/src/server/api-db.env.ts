import 'dotenv/config';
import { z } from 'zod';

export const DB_ENV_SHAPE = {
  DATABASE_URL: z.string().min(1),
  DB_MIGRATIONS_PATH: z.string().optional(),
};
