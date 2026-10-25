import { createHash } from 'node:crypto';

export const TEMPLATE_DOCUMENT_TYPES = [
  'report_card', 'id_card', 'admit_card', 'timetable', 'bill', 'receipt',
] as const;
export const TEMPLATE_PAGE_SIZES = ['full', 'half'] as const;

export type ApprovedTemplateObject = {
  sourceArtifactId: string;
  sourceSha256: string;
  sourceByteSize: number;
  sourceContentType: string;
  documentType: (typeof TEMPLATE_DOCUMENT_TYPES)[number];
  pageSize: (typeof TEMPLATE_PAGE_SIZES)[number];
  targetKey: string;
  targetContentType: string;
  targetByteSize: number;
  targetSha256: string;
};

export type ApprovedLogoObject = {
  sourceSha256: string;
  sourceByteSize: number;
  sourceContentType: string;
  targetKey: string;
  targetContentType: 'image/png';
};

type SourceManifestObject = {
  ownerId: string;
  key: string;
  sha256?: string;
  byteSize?: number;
  contentType?: string;
  exactLegacyCatalogMatches?: string[];
};

const templateType = {
  examination_template: 'report_card',
  idcard_template: 'id_card',
  admitcard_template: 'admit_card',
  timetable_template: 'timetable',
  bill_template: 'bill',
  receipt_template: 'receipt',
} as const;

/** Build the tracked-document object plan without introducing new keys or bytes. */
export function buildSharedObjectContracts(options: {
  schoolId: string;
  artifacts: Array<{ id: string; type: keyof typeof templateType; meta?: { size?: unknown } | null }>;
  objects: SourceManifestObject[];
}) {
  const byOwner = new Map(options.objects.map((item) => [item.ownerId, item]));
  const templates = options.artifacts.map((artifact): ApprovedTemplateObject => {
    const object = byOwner.get(artifact.id);
    if (!object?.sha256 || !Number.isSafeInteger(object.byteSize) || !object.contentType)
      throw new Error(`Template ${artifact.id} lacks verified shared-bucket metadata`);
    const documentType = templateType[artifact.type];
    const configuredSize = artifact.meta?.size;
    const pageSize = artifact.type === 'examination_template' ||
      artifact.type === 'idcard_template' || artifact.type === 'timetable_template'
      ? 'full'
      : artifact.type === 'admitcard_template' && object.exactLegacyCatalogMatches?.length
        ? 'half'
        : configuredSize === 'full' || configuredSize === 'half'
          ? configuredSize
          : undefined;
    if (!pageSize) throw new Error(`Template ${artifact.id} has no canonical page size`);
    return {
      sourceArtifactId: artifact.id,
      sourceSha256: object.sha256,
      sourceByteSize: object.byteSize!,
      sourceContentType: object.contentType,
      documentType,
      pageSize,
      targetKey: object.key,
      targetContentType: object.contentType,
      targetByteSize: object.byteSize!,
      targetSha256: object.sha256,
    };
  });
  const logo = byOwner.get(options.schoolId);
  if (!logo?.sha256 || !Number.isSafeInteger(logo.byteSize) || !logo.contentType)
    throw new Error('School logo lacks verified shared-bucket metadata');
  return {
    templates,
    schoolLogo: {
      sourceSha256: logo.sha256,
      sourceByteSize: logo.byteSize!,
      sourceContentType: logo.contentType,
      targetKey: logo.key,
      targetContentType: logo.contentType,
    } as ApprovedLogoObject,
  };
}

export function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Validate all content and representation facts that human approval binds. */
export function assertApprovedObject(options: {
  approved: ApprovedTemplateObject | ApprovedLogoObject;
  manifest: { key?: unknown; sha256?: unknown; byteSize?: unknown; contentType?: unknown };
  sourceBytes: Buffer;
  kind: 'template' | 'logo';
}) {
  const { approved, manifest, sourceBytes, kind } = options;
  if (
    approved.sourceSha256 !== manifest.sha256 ||
    approved.sourceByteSize !== manifest.byteSize ||
    approved.sourceContentType !== manifest.contentType ||
    sourceBytes.byteLength !== approved.sourceByteSize ||
    sha256(sourceBytes) !== approved.sourceSha256
  ) throw new Error(`Approved ${kind} source metadata does not match the object manifest`);

  if (approved.targetKey !== manifest.key)
    throw new Error(`Approved ${kind} must preserve the exact shared-bucket key`);
  if (kind === 'logo') {
    if (
      approved.targetContentType !== 'image/png' ||
      sourceBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    ) throw new Error('Approved logo is not a PNG');
  } else {
    const template = approved as ApprovedTemplateObject;
    if (!TEMPLATE_DOCUMENT_TYPES.includes(template.documentType))
      throw new Error('Approved template document type is invalid');
    if (!TEMPLATE_PAGE_SIZES.includes(template.pageSize))
      throw new Error('Approved template page size is invalid');
    if (template.targetContentType !== template.sourceContentType ||
      template.targetByteSize !== template.sourceByteSize ||
      template.targetSha256 !== template.sourceSha256 || sourceBytes.byteLength > 200_000)
      throw new Error('Shared template reference changes immutable source metadata');
  }
}
