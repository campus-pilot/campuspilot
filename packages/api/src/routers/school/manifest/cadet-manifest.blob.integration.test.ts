import { db } from '@campuspilot/db';
import { env } from '@campuspilot/env/server';
import { describe, expect, it } from 'vitest';

import { createTestSchool, setTestSchoolFeature } from '../../../../test/fixtures';
import { handleCadetManifestBlob } from './cadet-manifest.blob';

type Manifest = { id: string; name: string; short_name: string; start_url: string; scope: string; display: string; icons: Array<{ src: string }> };

async function manifestOf(schoolId: string) {
  const response = await handleCadetManifestBlob({ db }, { schoolId });
  return { response, manifest: (await response.json()) as Manifest };
}

describe('handleCadetManifestBlob', () => {
  it("installs a school's Cadet Portal as its own app on the portal origin", async () => {
    const school = await createTestSchool({ name: 'Maple Grove School', logoS3Key: 'schools/cadet-manifest/logo/logo.png', features: ['cadet'] });
    const { response, manifest } = await manifestOf(school.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/manifest+json');
    const portal = new URL('/', env.CADET_APP_URL).toString();
    expect(manifest).toMatchObject({
      id: new URL(`/?school=${school.id}`, env.CADET_APP_URL).toString(),
      name: 'Maple Grove School Cadet Portal',
      short_name: 'Maple Grove School',
      start_url: portal,
      scope: portal,
      display: 'standalone',
    });
    expect(manifest.icons.map((icon) => icon.src)).toEqual(['logo?size=192', 'logo?size=512']);
  });

  it('gives each school a distinct app id and falls back to portal icons', async () => {
    const [first, second] = await Promise.all([createTestSchool({ logoS3Key: null, features: ['cadet'] }), createTestSchool({ features: ['cadet'] })]);
    const [a, b] = await Promise.all([manifestOf(first.id), manifestOf(second.id)]);
    expect(a.manifest.id).not.toBe(b.manifest.id);
    expect(a.manifest.icons.map((icon) => icon.src)).toEqual([
      new URL('/app-icon-192.png', env.CADET_APP_URL).toString(),
      new URL('/app-icon-512.png', env.CADET_APP_URL).toString(),
    ]);
  });

  it('answers 404, like an unknown school, while the school has no Cadet Portal', async () => {
    const school = await createTestSchool({ name: 'No Portal School' });
    const missingRow = await handleCadetManifestBlob({ db }, { schoolId: school.id });
    expect(missingRow.status).toBe(404);
    const unknown = await handleCadetManifestBlob({ db }, { schoolId: 'sch_missing' });
    expect(await missingRow.json()).toEqual(await unknown.json());

    await setTestSchoolFeature(school.id, 'cadet', true);
    expect((await manifestOf(school.id)).manifest.name).toBe('No Portal School Cadet Portal');
    await setTestSchoolFeature(school.id, 'cadet', false);
    expect((await handleCadetManifestBlob({ db }, { schoolId: school.id })).status).toBe(404);
  });

  it('answers 404 for an unknown school', async () => {
    expect((await handleCadetManifestBlob({ db }, { schoolId: 'sch_missing' })).status).toBe(404);
  });
});
