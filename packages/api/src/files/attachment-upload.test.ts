import {
  ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE,
  ASSISTANT_DOCUMENT_MAX_BYTES,
  ASSISTANT_IMAGE_MAX_BYTES,
  hasPdfSignature,
} from '@campuspilot/assistant-contract/attachments';
import { describe, expect, it } from 'vitest';

import { attachmentTooLargeMessage, parseAttachmentUpload, sniffAttachmentKind } from './attachment-upload';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const WEBP = Uint8Array.from([...Buffer.from('RIFF'), 4, 0, 0, 0, ...Buffer.from('WEBP')]);
const HEIC = Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('mif1heic'), 0, 0, 0, 0]);
const PDF = Uint8Array.from(Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n', 'latin1'));
const HTML = Uint8Array.from(Buffer.from('<!doctype html><html><script>alert(1)</script></html>'));
const DOCX = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

function uploadRequest(bytes: Uint8Array, filename: string, type = 'application/octet-stream') {
  const form = new FormData();
  form.set('file', new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), filename);
  return new Request('http://localhost/upload', { method: 'POST', body: form });
}

const withLeading = (count: number, body: Uint8Array) => Uint8Array.from([...new Uint8Array(count).fill(0x20), ...body]);

describe('sniffAttachmentKind: the bytes decide', () => {
  it('recognises each image at offset 0 and a PDF', () => {
    expect(sniffAttachmentKind(JPEG)).toEqual({ kind: 'image', contentType: 'image/jpeg', extension: 'jpg' });
    expect(sniffAttachmentKind(PNG)).toEqual({ kind: 'image', contentType: 'image/png', extension: 'png' });
    expect(sniffAttachmentKind(WEBP)).toEqual({ kind: 'image', contentType: 'image/webp', extension: 'webp' });
    expect(sniffAttachmentKind(HEIC)).toEqual({ kind: 'image', contentType: 'image/heic', extension: 'heic' });
    expect(sniffAttachmentKind(PDF)).toEqual({ kind: 'document', contentType: 'application/pdf', extension: 'pdf' });
  });

  it('accepts %PDF- after leading bytes as far as readers do (the first 1,024 bytes), and not beyond', () => {
    expect(sniffAttachmentKind(withLeading(1, PDF))?.kind).toBe('document');
    expect(sniffAttachmentKind(withLeading(1019, PDF))?.kind).toBe('document');
    expect(sniffAttachmentKind(withLeading(1020, PDF))).toBeNull();
    expect(hasPdfSignature(Uint8Array.from(Buffer.from('%PDF')))).toBe(false);
    expect(hasPdfSignature(new Uint8Array())).toBe(false);
  });

  it('refuses HTML, Word files and anything else, whatever they are called', () => {
    expect(sniffAttachmentKind(HTML)).toBeNull();
    expect(sniffAttachmentKind(DOCX)).toBeNull();
    expect(sniffAttachmentKind(new Uint8Array())).toBeNull();
  });

  it('decides an image by its signature at offset 0 even when %PDF- follows', () => {
    expect(sniffAttachmentKind(Uint8Array.from([...JPEG, ...PDF]))?.kind).toBe('image');
  });
});

describe('parseAttachmentUpload', () => {
  it('takes a PDF by its bytes, whatever its name and declared type say', async () => {
    const parsed = await parseAttachmentUpload(uploadRequest(PDF, 'paper.png', 'image/png'), { fieldName: 'file' });
    expect(parsed).toMatchObject({ kind: 'document', contentType: 'application/pdf', extension: 'pdf', fileName: 'paper.png' });
    expect(Buffer.compare(parsed.bytes, Buffer.from(PDF))).toBe(0);
  });

  it('takes an image named .pdf as an image', async () => {
    const parsed = await parseAttachmentUpload(uploadRequest(JPEG, 'scan.pdf', 'application/pdf'), { fieldName: 'file' });
    expect(parsed).toMatchObject({ kind: 'image', contentType: 'image/jpeg', extension: 'jpg' });
  });

  it('refuses HTML or Word bytes named .pdf with the sentence that says to save as PDF', async () => {
    for (const bytes of [HTML, DOCX]) {
      await expect(parseAttachmentUpload(uploadRequest(bytes, 'paper.pdf', 'application/pdf'), { fieldName: 'file' })).rejects.toMatchObject({
        status: 415,
        message: ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE,
      });
    }
    expect(ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE).toContain('Save Word and other documents as PDF');
  });

  it('caps a PDF at 10 MB and an image at 15 MB, each with its own sentence', async () => {
    const bigPdf = new Uint8Array(ASSISTANT_DOCUMENT_MAX_BYTES + 1);
    bigPdf.set(PDF);
    await expect(parseAttachmentUpload(uploadRequest(bigPdf, 'big.pdf'), { fieldName: 'file' })).rejects.toMatchObject({
      status: 413,
      message: attachmentTooLargeMessage('document'),
    });
    expect(attachmentTooLargeMessage('document')).toBe('A PDF must be 10 MB or smaller.');

    const okPdf = new Uint8Array(ASSISTANT_DOCUMENT_MAX_BYTES);
    okPdf.set(PDF);
    await expect(parseAttachmentUpload(uploadRequest(okPdf, 'ok.pdf'), { fieldName: 'file' })).resolves.toMatchObject({ kind: 'document' });

    const bigImage = new Uint8Array(ASSISTANT_IMAGE_MAX_BYTES + 1);
    bigImage.set(JPEG);
    await expect(parseAttachmentUpload(uploadRequest(bigImage, 'big.jpg'), { fieldName: 'file' })).rejects.toMatchObject({ status: 413 });
  });

  it('refuses an empty file', async () => {
    await expect(parseAttachmentUpload(uploadRequest(new Uint8Array(), 'empty.pdf'), { fieldName: 'file' })).rejects.toMatchObject({ status: 400 });
  });
});
