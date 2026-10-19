import { describe, expect, it } from 'vitest';

import { parseDocumentUpload } from './document-upload';

const options = { fieldName: 'document', maxBytes: 8 };

function documentRequest(
  bytes: Uint8Array<ArrayBuffer> | string,
  filename: string,
  type = 'application/pdf',
  fieldName = 'document',
) {
  const formData = new FormData();
  formData.set(fieldName, new Blob([bytes], { type }), filename);
  return new Request('http://localhost/upload', {
    method: 'POST',
    body: formData,
  });
}

describe('parseDocumentUpload', () => {
  it('returns the exact bytes, filename, and declared media type', async () => {
    const result = await parseDocumentUpload(
      documentRequest('%PDF', 'report.pdf'),
      options,
    );

    expect(result).toEqual({
      bytes: Buffer.from('%PDF'),
      contentType: 'application/pdf',
      fileName: 'report.pdf',
    });
  });

  it('allows opaque document formats without inspecting their signatures', async () => {
    const result = await parseDocumentUpload(
      documentRequest('notes', 'notes.txt', 'text/plain'),
      options,
    );

    expect(result.contentType).toBe('text/plain');
    expect(result.bytes.toString()).toBe('notes');
  });

  it('requires a request body', () => {
    const request = new Request('http://localhost/upload', { method: 'POST' });

    expect(() => parseDocumentUpload(request, options)).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'A multipart request body is required.',
      }),
    );
  });

  it('requires valid multipart headers', async () => {
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      body: 'plain text',
      headers: { 'content-type': 'text/plain' },
    });

    await expect(parseDocumentUpload(request, options)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'A valid multipart/form-data request is required.',
    });
  });

  it('requires exactly one file', async () => {
    const empty = new FormData();
    await expect(
      parseDocumentUpload(
        new Request('http://localhost/upload', {
          method: 'POST',
          body: empty,
        }),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Upload exactly one admission document.',
    });

    const twoFiles = new FormData();
    twoFiles.append('document', new Blob(['one']), 'one.txt');
    twoFiles.append('document', new Blob(['two']), 'two.txt');
    await expect(
      parseDocumentUpload(
        new Request('http://localhost/upload', {
          method: 'POST',
          body: twoFiles,
        }),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Upload exactly one admission document.',
    });
  });

  it('rejects a file under the wrong field name', async () => {
    await expect(
      parseDocumentUpload(
        documentRequest('notes', 'notes.txt', 'text/plain', 'file'),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: "The document field must be named 'document'.",
    });
  });

  it('rejects empty and overlong filenames', async () => {
    await expect(
      parseDocumentUpload(documentRequest('notes', ' ', 'text/plain'), options),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      parseDocumentUpload(
        documentRequest('notes', `${'a'.repeat(252)}.txt`, 'text/plain'),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'The document filename must be between 1 and 255 characters.',
    });
  });

  it('rejects empty document bytes', async () => {
    await expect(
      parseDocumentUpload(
        documentRequest(new Uint8Array(), 'empty.pdf'),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'The admission document cannot be empty.',
    });
  });

  it('rejects files beyond the configured byte limit', async () => {
    await expect(
      parseDocumentUpload(
        documentRequest('123456789', 'large.txt', 'text/plain'),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Each admission document must be 0 MB or smaller.',
    });
  });

  it('rejects additional form fields', async () => {
    const formData = new FormData();
    formData.set('document', new Blob(['notes']), 'notes.txt');
    formData.set('description', 'not allowed');

    await expect(
      parseDocumentUpload(
        new Request('http://localhost/upload', {
          method: 'POST',
          body: formData,
        }),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Additional form fields are not allowed.',
    });
  });
});
