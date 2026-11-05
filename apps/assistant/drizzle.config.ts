import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

dotenv.config({ path: '.env' });

/**
 * The assistant owns the `assistant` Postgres schema and nothing else. Its
 * migrations and their journal table live there too, independent of the
 * API's migrations.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  schemaFilter: ['assistant'],
  migrations: { schema: 'assistant', table: '__assistant_migrations' },
  dbCredentials: { url: process.env.ASSISTANT_DATABASE_URL ?? '' },
});
