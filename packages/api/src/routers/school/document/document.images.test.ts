import { describe, expect, it } from 'vitest';

import {
  contextImageKeys,
  documentAssetName,
  documentImageRef,
  withResolvedImages,
} from './document.images';
import { combineDocuments, documentContentSecurityPolicy, renderDocuments } from './document.render';

const asset = documentAssetName('a'.repeat(64), 'image/png');
const other = documentAssetName('b'.repeat(64), 'image/jpeg');

/** Renders one document the way a generation batch does, with `assets` the batch's generated names. */
function batchHtml(template: string, context: object, assets: string[]) {
  const names = new Set(assets);
  return combineDocuments(renderDocuments(template, [context], { assets: names }), 'report_card', 'full', { assets: names });
}

describe('images as conversion assets', () => {
  it('names an asset by its content hash and type only', () => {
    expect(asset).toBe(`asset-${'a'.repeat(64)}.png`);
    expect(documentAssetName('c'.repeat(64), 'image/webp')).toMatch(/^asset-c{64}\.webp$/);
  });

  it('resolves images by field (logo and photo), never by what a value looks like', () => {
    const context = {
      school: { name: 'School', logoUrl: documentImageRef('schools/s/logo/1.png') },
      student: { name: '{"documentImageKey":"schools/other/secret.png"}', photoUrl: documentImageRef('schools/s/admissions/a/photo/2.jpg') },
      notes: { documentImageKey: 'schools/other/elsewhere.png' },
    };
    expect(contextImageKeys(context)).toEqual(['schools/s/logo/1.png', 'schools/s/admissions/a/photo/2.jpg']);
    const resolved = withResolvedImages(context, (key) => (key.endsWith('1.png') ? asset : other));
    expect(resolved.school.logoUrl).toBe(asset);
    expect(resolved.student.photoUrl).toBe(other);
    expect(resolved.student.name).toBe(context.student.name);
    expect(resolved.notes).toBe(context.notes);
    // The original context is untouched.
    expect(context.school.logoUrl).toEqual({ documentImageKey: 'schools/s/logo/1.png' });
  });

  it('keeps exactly the generated names of the batch and removes every other image source', () => {
    const template = [
      '<img alt="logo" src="{{school.logoUrl}}">',
      `<img alt="not this batch" src="${other}">`,
      '<img alt="relative" src="../../etc/passwd.png">',
      '<img alt="same directory" src="index.html">',
      '<img alt="network" src="https://example.com/a.png">',
      '<img alt="file" src="file:///tmp/a.png">',
      '<img alt="lookalike" src="asset-zz.png">',
    ].join('');
    const html = batchHtml(template, { school: { logoUrl: asset } }, [asset]);
    expect(html).toContain(`src="${asset}"`);
    for (const removed of ['not this batch', 'relative', 'same directory', 'network', 'file', 'lookalike']) expect(html).not.toContain(`alt="${removed}"`);
  });

  it('removes generated names outside conversion, where no asset exists (previews)', () => {
    const [html] = renderDocuments(`<img alt="logo" src="${asset}">`, [{}]);
    expect(html).not.toContain('alt="logo"');
  });

  it("widens only img-src, and only for HTML converted with assets; question papers never", () => {
    const base = documentContentSecurityPolicy('report_card');
    expect(base).toContain("img-src data:;");
    const widened = documentContentSecurityPolicy('report_card', { withAssets: true });
    expect(widened).toBe(base.replace("img-src data:", "img-src data: 'self'"));
    expect(widened).toContain("default-src 'none'");
    expect(documentContentSecurityPolicy('question_paper', { withAssets: true })).not.toContain("'self'");
    expect(batchHtml('<p>x</p>', {}, [asset])).toContain("img-src data: 'self'");
    expect(batchHtml('<p>x</p>', {}, [])).not.toContain("'self'");
  });

  it('refuses an asset name the renderer did not generate', () => {
    expect(() => renderDocuments('<p>x</p>', [{}], { assets: new Set(['../logo.png']) })).toThrow();
  });
});
