import { describe, expect, it } from 'vitest';

import { SOURCE_DISPOSITION_FAMILY_KEYS, type SourceDispositionCounts } from './dispositions.ts';
import { assertSourceObjectManifest, type SourceObjectManifest } from './source-object-manifest.ts';

const counts = () => Object.fromEntries(
  SOURCE_DISPOSITION_FAMILY_KEYS.map((key) => [key, 0]),
) as SourceDispositionCounts;

describe('source object manifest reconciliation', () => {
  it('accepts one exact terminal family per object', () => {
    const dispositionCounts = counts();
    dispositionCounts['school.logo_object'] = 1;
    dispositionCounts['artifact.template_object'] = 1;
    const manifest: SourceObjectManifest = { schemaVersion: 1, objects: [
      { ownerId: 'school', schoolId: 'school', key: 'logo', dispositionFamily: 'school.logo_object', transferPolicy: 'reference', status: 'available' },
      { ownerId: 'template', schoolId: 'school', key: 'template', dispositionFamily: 'artifact.template_object', transferPolicy: 'reference', status: 'available' },
    ] };
    expect(() => assertSourceObjectManifest(manifest, { dispositionCounts } as never)).not.toThrow();
  });

  it('rejects an incomplete or double-counted inventory', () => {
    const dispositionCounts = counts();
    dispositionCounts['artifact.notice_object'] = 1;
    expect(() => assertSourceObjectManifest({ schemaVersion: 1, objects: [] }, { dispositionCounts } as never)).toThrow('does not reconcile');
  });

  it('rejects the same object assigned to two terminal families', () => {
    const dispositionCounts = counts();
    dispositionCounts['artifact.template_object'] = 1;
    dispositionCounts['artifact.unknown'] = 1;
    const manifest: SourceObjectManifest = { schemaVersion: 1, objects: [
      { ownerId: 'template-artifact', schoolId: 'school', key: 'same-key', dispositionFamily: 'artifact.template_object', transferPolicy: 'reference', status: 'available' },
      { ownerId: 'unknown-artifact', schoolId: 'school', key: 'same-key', dispositionFamily: 'artifact.unknown', transferPolicy: 'block', status: 'reference-only' },
    ] };
    expect(() => assertSourceObjectManifest(manifest, { dispositionCounts } as never)).toThrow('Duplicate');
  });
});
