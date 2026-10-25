import { runMigrations } from '@campuspilot/db/migrate';

runMigrations().catch((error) => {
  console.error('Database migration failed', error);
  process.exit(1);
});
