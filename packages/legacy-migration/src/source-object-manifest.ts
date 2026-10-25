import type { SourceEvidence } from './source-evidence.ts';

export const OBJECT_DISPOSITION_FAMILIES = [
  'admission.photo_object',
  'artifact.generated_pdf_object',
  'artifact.notice_object',
  'artifact.template_object',
  'artifact.unknown',
  'school.logo_object',
] as const;

type ObjectDispositionFamily = (typeof OBJECT_DISPOSITION_FAMILIES)[number];

export type SourceObjectManifest = {
  schemaVersion: 1;
  objects: Array<{
    ownerId: string;
    schoolId: string;
    key: string;
    dispositionFamily: ObjectDispositionFamily;
    transferPolicy: 'reference' | 'omit' | 'block';
    status: 'available' | 'missing' | 'reference-only';
    [key: string]: unknown;
  }>;
};

const expectedPolicy: Record<ObjectDispositionFamily, 'reference' | 'omit' | 'block'> = {
  'admission.photo_object': 'omit',
  'artifact.generated_pdf_object': 'omit',
  'artifact.notice_object': 'omit',
  'artifact.template_object': 'reference',
  'artifact.unknown': 'block',
  'school.logo_object': 'reference',
};

/** Prove every DB object reference appears once in one terminal family. */
export function assertSourceObjectManifest(
  manifest: SourceObjectManifest,
  evidence: SourceEvidence,
): void {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.objects))
    throw new Error('Source object manifest does not use schema version 1');
  const counts = Object.fromEntries(OBJECT_DISPOSITION_FAMILIES.map((family) => [family, 0])) as Record<ObjectDispositionFamily, number>;
  const identities = new Set<string>();
  for (const object of manifest.objects) {
    if (!OBJECT_DISPOSITION_FAMILIES.includes(object.dispositionFamily) ||
      object.transferPolicy !== expectedPolicy[object.dispositionFamily])
      throw new Error(`Object ${object.ownerId} has no canonical terminal family/policy`);
    const identity = object.key;
    if (identities.has(identity)) throw new Error(`Duplicate source object manifest entry ${object.ownerId}`);
    identities.add(identity);
    counts[object.dispositionFamily] += 1;
    if (object.transferPolicy === 'reference' && object.status !== 'available')
      throw new Error(`Referenced source object ${object.ownerId} is unavailable`);
    if (object.transferPolicy !== 'reference' && object.status !== 'reference-only')
      throw new Error(`Non-imported source object ${object.ownerId} must remain reference-only`);
  }
  for (const family of OBJECT_DISPOSITION_FAMILIES) {
    if (counts[family] !== evidence.dispositionCounts[family])
      throw new Error(`Source object manifest count does not reconcile for ${family}`);
  }
}
