import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE, PDF_HEADER_SEARCH_BYTES } from '@campuspilot/assistant-contract/attachments';

import { assistantAttachmentKindOf, assistantAttachmentKindOfBytes, prepareAssistantAttachment } from '@/lib/assistant-attachment-kind';

const bytes = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const WEBP = Uint8Array.from([...bytes('RIFF'), 4, 0, 0, 0, ...bytes('WEBP')]);
const HEIC = Uint8Array.from([0, 0, 0, 24, ...bytes('ftypheic'), 0, 0, 0, 0, ...bytes('mif1heic'), 0, 0, 0, 0]);
const AVIF = Uint8Array.from([0, 0, 0, 24, ...bytes('ftypavif'), 0, 0, 0, 0, ...bytes('mif1avif'), 0, 0, 0, 0]);
const PDF = bytes('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n');
const HTML = bytes('<!doctype html><html><script>alert(1)</script></html>');
const DOCX = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const withLeading = (count: number, body: Uint8Array) => Uint8Array.from([...new Uint8Array(count).fill(0x20), ...body]);
const file = (body: Uint8Array, name: string, type: string) => new File([body as Uint8Array<ArrayBuffer>], name, { type });

describe('assistantAttachmentKindOfBytes', () => {
  test('recognises every accepted image at offset 0', () => {
    for (const image of [JPEG, PNG, WEBP, HEIC]) assert.equal(assistantAttachmentKindOfBytes(image), 'image');
  });

  test('takes %PDF- at offset 0 and after leading bytes within the first 1,024, not beyond', () => {
    assert.equal(assistantAttachmentKindOfBytes(PDF), 'document');
    assert.equal(assistantAttachmentKindOfBytes(withLeading(1, PDF)), 'document');
    assert.equal(assistantAttachmentKindOfBytes(withLeading(PDF_HEADER_SEARCH_BYTES - 5, PDF)), 'document');
    assert.equal(assistantAttachmentKindOfBytes(withLeading(PDF_HEADER_SEARCH_BYTES - 4, PDF)), null);
  });

  test('refuses HTML, Word files, AVIF and empty files', () => {
    for (const other of [HTML, DOCX, AVIF, new Uint8Array(), bytes('%PDF')]) assert.equal(assistantAttachmentKindOfBytes(other), null);
  });

  test('an image signature wins over a %PDF- that follows it', () => {
    assert.equal(assistantAttachmentKindOfBytes(Uint8Array.from([...JPEG, ...PDF])), 'image');
  });
});

describe('assistantAttachmentKindOf: the bytes decide, never the name or the declared type', () => {
  test('a .pdf name with image bytes is an image', async () => {
    assert.equal(await assistantAttachmentKindOf(file(JPEG, 'scan.pdf', 'application/pdf')), 'image');
  });

  test('a .pdf name with HTML bytes is refused', async () => {
    assert.equal(await assistantAttachmentKindOf(file(HTML, 'paper.pdf', 'application/pdf')), null);
  });

  test('a PDF named and typed as an image is a document', async () => {
    assert.equal(await assistantAttachmentKindOf(file(PDF, 'photo.jpg', 'image/jpeg')), 'document');
  });

  test('a Word file is refused whatever it is called', async () => {
    assert.equal(await assistantAttachmentKindOf(file(DOCX, 'paper.pdf', '')), null);
  });

  test('reads only the leading bytes: a header past them does not count', async () => {
    const late = withLeading(PDF_HEADER_SEARCH_BYTES, PDF);
    assert.equal(await assistantAttachmentKindOf(file(late, 'late.pdf', 'application/pdf')), null);
  });
});

describe('prepareAssistantAttachment', () => {
  /** An image preparation that records what it was given and returns a converted copy. */
  function recordingPreparation() {
    const seen: string[] = [];
    return {
      seen,
      prepare: async (image: File) => {
        seen.push(image.name);
        return new File([JPEG as Uint8Array<ArrayBuffer>], 'converted.jpg', { type: 'image/jpeg' });
      },
    };
  }

  test('a PDF goes up exactly as picked and never through the image preparation', async () => {
    const preparation = recordingPreparation();
    const picked = file(PDF, 'old paper.heic', 'image/heic');
    const prepared = await prepareAssistantAttachment(picked, preparation.prepare);
    assert.equal(prepared.kind, 'document');
    assert.equal(prepared.file, picked);
    assert.deepEqual(preparation.seen, []);
  });

  test('an image goes through the image preparation', async () => {
    const preparation = recordingPreparation();
    const prepared = await prepareAssistantAttachment(file(HEIC, 'photo.heic', 'image/heic'), preparation.prepare);
    assert.equal(prepared.kind, 'image');
    assert.equal(prepared.file.name, 'converted.jpg');
    assert.deepEqual(preparation.seen, ['photo.heic']);
  });

  test('anything else is refused before upload with the sentence that says to save as PDF', async () => {
    const preparation = recordingPreparation();
    await assert.rejects(prepareAssistantAttachment(file(DOCX, 'paper.docx', ''), preparation.prepare), {
      message: ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE,
    });
    assert.match(ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE, /Save Word and other documents as PDF/);
    assert.deepEqual(preparation.seen, []);
  });
});
