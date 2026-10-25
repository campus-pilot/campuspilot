import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationDocDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migration/doc',
);

/**
 * Hash every tracked Markdown migration contract using stable relative names.
 * Untracked operator artifacts never participate in the executable policy.
 */
export async function migrationDocsSha256() {
  const filenames = (await readdir(migrationDocDirectory))
    .filter((filename) => filename.endsWith('.md'))
    .toSorted();
  if (filenames.length === 0)
    throw new Error('Tracked migration documentation is missing');
  const digest = createHash('sha256');
  for (const filename of filenames) {
    digest.update(filename);
    digest.update('\0');
    digest.update(await readFile(path.join(migrationDocDirectory, filename)));
    digest.update('\0');
  }
  return digest.digest('hex');
}
