import { describe, expect, it } from 'vitest';

import { parseImageUpload, QUESTION_PAPER_IMAGE_FAMILY } from './image-upload';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Uint8Array.from([
  ...Buffer.from('RIFF'),
  0x04,
  0x00,
  0x00,
  0x00,
  ...Buffer.from('WEBP'),
]);

const options = {
  fieldName: 'image',
  maxBytes: 16,
  subject: 'avatar',
};

function imageRequest(
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
  filename: string,
  fieldName = 'image',
) {
  const formData = new FormData();
  formData.set(fieldName, new Blob([bytes], { type }), filename);
  return new Request('http://localhost/upload', {
    method: 'POST',
    body: formData,
  });
}

describe('parseImageUpload', () => {
  it.each([
    ['PNG', PNG, 'image/png', 'avatar.PNG', 'png'],
    ['JPEG', JPEG, 'image/jpeg', 'avatar.JPEG', 'jpeg'],
    ['WebP', WEBP, 'image/webp', 'avatar.webp', 'webp'],
  ])(
    'accepts one bounded %s whose signature, media type, and extension agree',
    async (_label, bytes, type, filename, extension) => {
      const result = await parseImageUpload(
        imageRequest(bytes, type, filename),
        options,
      );

      expect(result).toEqual({
        bytes: Buffer.from(bytes),
        contentType: type,
        extension,
        fileName: filename,
      });
    },
  );

  it('requires a request body', () => {
    const request = new Request('http://localhost/upload', { method: 'POST' });

    expect(() => parseImageUpload(request, options)).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'A multipart request body is required.',
      }),
    );
  });

  it('requires a valid multipart content type', async () => {
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      body: 'plain text',
      headers: { 'content-type': 'text/plain' },
    });

    await expect(parseImageUpload(request, options)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'A valid multipart/form-data request is required.',
    });
  });

  it('requires exactly one file', async () => {
    const noFile = new FormData();
    await expect(
      parseImageUpload(
        new Request('http://localhost/upload', {
          method: 'POST',
          body: noFile,
        }),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Upload exactly one avatar.',
    });

    const twoFiles = new FormData();
    twoFiles.append('image', new Blob([PNG], { type: 'image/png' }), 'one.png');
    twoFiles.append('image', new Blob([PNG], { type: 'image/png' }), 'two.png');
    await expect(
      parseImageUpload(
        new Request('http://localhost/upload', {
          method: 'POST',
          body: twoFiles,
        }),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Upload exactly one avatar.',
    });
  });

  it('rejects a file under the wrong field name', async () => {
    await expect(
      parseImageUpload(
        imageRequest(PNG, 'image/png', 'avatar.png', 'file'),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: "The image field must be named 'image'.",
    });
  });

  it('rejects additional form fields', async () => {
    const formData = new FormData();
    formData.set('image', new Blob([PNG], { type: 'image/png' }), 'avatar.png');
    formData.set('caption', 'not allowed');

    await expect(
      parseImageUpload(
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

  it('rejects unsupported declared media types', async () => {
    await expect(
      parseImageUpload(
        imageRequest(Uint8Array.from([1, 2, 3]), 'image/gif', 'avatar.gif'),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'The avatar must be a JPEG, PNG, or WebP image.',
    });
  });

  it('rejects a filename extension that disagrees with the media type', async () => {
    await expect(
      parseImageUpload(imageRequest(PNG, 'image/png', 'avatar.jpg'), options),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message:
        'The avatar filename extension must match its image format.',
    });
  });

  it('rejects bytes whose signature disagrees with the media type', async () => {
    await expect(
      parseImageUpload(
        imageRequest(Uint8Array.from([1, 2, 3]), 'image/png', 'avatar.png'),
        options,
      ),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'The uploaded file does not match its image format.',
    });
  });

  it('rejects files beyond the configured byte limit', async () => {
    const bytes = Uint8Array.from([...PNG, ...new Uint8Array(16)]);

    await expect(
      parseImageUpload(imageRequest(bytes, 'image/png', 'avatar.png'), options),
    ).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The avatar must be 0 MB or smaller.',
    });
  });
});

/** An ISO-BMFF `ftyp` box with the given major brand and compatible brands. */
function ftyp(major: string, ...compatible: string[]) {
  const size = 16 + compatible.length * 4;
  const bytes = new Uint8Array(size + 8);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(Buffer.from(`ftyp${major}`), 4);
  compatible.forEach((brand, index) => bytes.set(Buffer.from(brand), 16 + index * 4));
  return bytes;
}

describe('parseImageUpload with the question paper family', () => {
  const paperOptions = { ...options, maxBytes: 4096, family: QUESTION_PAPER_IMAGE_FAMILY, subject: 'page' };

  it.each([
    ['heic major brand', ftyp('heic', 'mif1', 'heic'), 'image/heic', 'IMG_1.HEIC', 'heic'],
    ['mif1 major with an HEVC compatible brand', ftyp('mif1', 'MiHE', 'heic'), 'image/heif', 'scan.heif', 'heif'],
    ['image/heif declared for a .heic file', ftyp('heix'), 'image/heif', 'IMG_2.heic', 'heic'],
  ])('accepts %s', async (_label, bytes, type, filename, extension) => {
    const result = await parseImageUpload(imageRequest(bytes as Uint8Array<ArrayBuffer>, type, filename), paperOptions);
    expect(result).toMatchObject({ contentType: type, extension });
  });

  it('still accepts JPEG, PNG and WebP', async () => {
    await expect(parseImageUpload(imageRequest(JPEG, 'image/jpeg', 'p.jpg'), paperOptions)).resolves.toMatchObject({ contentType: 'image/jpeg' });
  });

  it('treats a generic media type as HEIC only for a .heic or .heif name whose bytes are HEIF', async () => {
    const ok = await parseImageUpload(imageRequest(ftyp('heic', 'mif1'), 'application/octet-stream', 'IMG.HEIC'), paperOptions);
    expect(ok).toMatchObject({ contentType: 'image/heic', extension: 'heic' });
    await expect(parseImageUpload(imageRequest(JPEG, 'application/octet-stream', 'photo.jpg'), paperOptions)).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'The page must be a JPEG, PNG, WebP, HEIC, or HEIF image.',
    });
    await expect(parseImageUpload(imageRequest(PNG, 'application/octet-stream', 'x.heic'), paperOptions)).rejects.toMatchObject({
      message: 'The uploaded file does not match its image format.',
    });
  });

  it.each([
    ['AVIF with a mif1 compatible brand', ftyp('avif', 'mif1', 'miaf')],
    ['AVIF that lists avif only as a compatible brand', ftyp('mif1', 'avif')],
    ['an MP4 video', ftyp('isom', 'iso2', 'mp41')],
    ['a file shorter than a box', Uint8Array.from([0, 0, 0, 12, ...Buffer.from('ftypheic')])],
    ['a box that claims to be longer than the file', (() => { const bytes = ftyp('heic'); new DataView(bytes.buffer).setUint32(0, 400); return bytes; })()],
    ['bytes without ftyp', Uint8Array.from(new Array(40).fill(7))],
  ])('rejects %s even when declared as image/heic', async (_label, bytes) => {
    await expect(parseImageUpload(imageRequest(bytes as Uint8Array<ArrayBuffer>, 'image/heic', 'a.heic'), paperOptions)).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'The uploaded file does not match its image format.',
    });
  });

  it('keeps the default routes JPEG, PNG and WebP only', async () => {
    await expect(parseImageUpload(imageRequest(ftyp('heic'), 'image/heic', 'a.heic'), options)).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'The avatar must be a JPEG, PNG, or WebP image.',
    });
  });

  it('rejects a HEIC over the byte limit', async () => {
    await expect(
      parseImageUpload(imageRequest(Uint8Array.from([...ftyp('heic'), ...new Uint8Array(5000)]), 'image/heic', 'a.heic'), { ...paperOptions, maxBytes: 4096 }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});
