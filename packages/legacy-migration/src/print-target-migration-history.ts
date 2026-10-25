import { createHash } from 'node:crypto';

import {
  migrationHistory,
  migrationHistoryCopyBytes,
  targetMigrationDirectory,
} from './migration-history.ts';

const history = await migrationHistory(targetMigrationDirectory);
const checksum = createHash('sha256')
  .update(migrationHistoryCopyBytes(history))
  .digest('hex');

process.stdout.write(`${checksum}\n`);
