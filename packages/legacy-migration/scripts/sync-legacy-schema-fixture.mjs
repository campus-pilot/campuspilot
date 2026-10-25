import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [legacyDrizzleDirectory, fixtureDirectory, existingFixture] = process.argv.slice(2);
if (!legacyDrizzleDirectory || !fixtureDirectory || !existingFixture)
  throw new Error('usage: sync-legacy-schema-fixture.mjs <legacy-drizzle> <fixture-dir> <old-fixture.sql>');

const fixture = await readFile(existingFixture, 'utf8');
const dataStart = fixture.indexOf('INSERT INTO school VALUES');
if (dataStart < 0) throw new Error('Existing synthetic fixture has no data marker');
await mkdir(fixtureDirectory, { recursive: true });
await writeFile(path.join(fixtureDirectory, 'synthetic-data.sql'), fixture.slice(dataStart), { mode: 0o644 });
const journal = JSON.parse(await readFile(path.join(legacyDrizzleDirectory, 'meta/_journal.json'), 'utf8'));
for (const entry of journal.entries) {
  await copyFile(
    path.join(legacyDrizzleDirectory, `${entry.tag}.sql`),
    path.join(fixtureDirectory, `${entry.tag}.sql`),
  );
}
await mkdir(path.join(fixtureDirectory, 'meta'), { recursive: true });
await writeFile(path.join(fixtureDirectory, 'meta/_journal.json'), `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o644 });
await rm(existingFixture);
