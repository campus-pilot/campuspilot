import { db } from '@campuspilot/db';
import { env } from '@campuspilot/env/server';
import { describe, expect, it } from 'vitest';

import { createTestSchool } from '../../../../test/fixtures';
import { handleSchoolManifestBlob } from './manifest.blob';

type Manifest = {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  launch_handler: { client_mode: string[] };
  icons: Array<{ src: string; sizes: string; type: string }>;
};

describe('handleSchoolManifestBlob', () => {
  it('serves a public manifest that installs the school as its own app', async () => {
    const school = await createTestSchool({
      name: 'Maple Grove School',
      logoS3Key: 'schools/manifest-test/logo/logo.png',
    });

    const response = await handleSchoolManifestBlob({ db }, { schoolId: school.id });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/manifest+json');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    const manifest = (await response.json()) as Manifest;
    const schoolUrl = new URL(`/school/${school.id}`, env.PUBLIC_APP_URL).toString();
    expect(manifest).toMatchObject({
      id: schoolUrl,
      name: 'Maple Grove School',
      short_name: 'Maple Grove School',
      start_url: schoolUrl,
      scope: schoolUrl,
      display: 'standalone',
      // Captured links reuse the open app window instead of opening another.
      launch_handler: { client_mode: ['navigate-existing', 'auto'] },
    });
    // Relative to the manifest URL, so they resolve to the public logo blob.
    expect(manifest.icons).toEqual([
      { src: 'logo?size=192', sizes: '192x192', type: 'image/png' },
      { src: 'logo?size=512', sizes: '512x512', type: 'image/png' },
    ]);
  });

  it('gives each school a distinct app id', async () => {
    const [first, second] = await Promise.all([createTestSchool(), createTestSchool()]);

    const [firstManifest, secondManifest] = await Promise.all(
      [first, second].map(async (school) =>
        (await (await handleSchoolManifestBlob({ db }, { schoolId: school.id })).json()) as Manifest,
      ),
    );

    expect(firstManifest!.id).not.toBe(secondManifest!.id);
  });

  it('falls back to CampusPilot icons when the school has no logo', async () => {
    const school = await createTestSchool({ logoS3Key: null });

    const manifest = (await (
      await handleSchoolManifestBlob({ db }, { schoolId: school.id })
    ).json()) as Manifest;

    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      new URL('/app-icon-192.png', env.PUBLIC_APP_URL).toString(),
      new URL('/app-icon-512.png', env.PUBLIC_APP_URL).toString(),
    ]);
  });

  it('returns NOT_FOUND for an unknown school', async () => {
    const response = await handleSchoolManifestBlob({ db }, { schoolId: 'sch_does_not_exist' });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an empty school id with BAD_REQUEST', async () => {
    const response = await handleSchoolManifestBlob({ db }, { schoolId: '' });

    expect(response.status).toBe(400);
  });
});
