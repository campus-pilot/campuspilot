import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolute)));
    else if (entry.isFile() && !entry.name.endsWith('.test.ts')) files.push(absolute);
  }
  return files;
}

/** Compute immutable release provenance without serializing configuration or secrets. */
export async function importerProvenance() {
  const { stdout: commitOutput } = await execFile('git', [
    '-C',
    packageRoot,
    'rev-parse',
    'HEAD',
  ]);
  const commit = commitOutput.trim();
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error('Importer Git commit is not a full immutable SHA');

  const { stdout: dirtyOutput } = await execFile('git', [
    '-C',
    packageRoot,
    'status',
    '--porcelain',
  ]);
  if (dirtyOutput.trim())
    throw new Error('Importer repository has uncommitted changes');

  const files = (await sourceFiles(path.join(packageRoot, 'src'))).toSorted();
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(path.relative(packageRoot, file));
    digest.update('\0');
    digest.update(await readFile(file));
    digest.update('\0');
  }
  for (const name of ['package.json', 'tsconfig.json']) {
    digest.update(name);
    digest.update('\0');
    digest.update(await readFile(path.join(packageRoot, name)));
    digest.update('\0');
  }
  return { gitCommit: commit, checksumSha256: digest.digest('hex') };
}
