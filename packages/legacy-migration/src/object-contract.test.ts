import { describe, expect, it } from 'vitest';

import { assertApprovedObject, sha256, type ApprovedTemplateObject } from './object-contract.ts';

const source = Buffer.from('legacy');
const approved: ApprovedTemplateObject = {
  sourceArtifactId: 'a1', sourceSha256: sha256(source), sourceByteSize: source.byteLength,
  sourceContentType: 'text/plain', documentType: 'bill', pageSize: 'half',
  targetKey: 'legacy/templates/bill.hbs',
  targetContentType: 'text/plain', targetByteSize: source.byteLength,
  targetSha256: sha256(source),
};

describe('approved object contract', () => {
  it('binds source metadata and the exact shared-bucket key', () => {
    expect(() => assertApprovedObject({ approved, manifest: { key: approved.targetKey, sha256: sha256(source), byteSize: source.byteLength, contentType: 'text/plain' }, sourceBytes: source, kind: 'template' })).not.toThrow();
  });
  it('rejects any attempted key or checksum rewrite', () => {
    expect(() => assertApprovedObject({ approved: { ...approved, targetKey: 'new/key.hbs', targetSha256: '0'.repeat(64) }, manifest: { key: approved.targetKey, sha256: sha256(source), byteSize: source.byteLength, contentType: 'text/plain' }, sourceBytes: source, kind: 'template' })).toThrow('exact shared-bucket key');
  });
});
