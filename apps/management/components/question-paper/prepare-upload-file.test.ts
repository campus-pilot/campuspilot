import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { prepareUploadFile, type ImageDecoder } from './prepare-upload-file';

const fileOf = (name: string, type: string, size = 100) => new File([new Uint8Array(size)], name, { type });
const decoderYielding = (blob: Blob | null, closed: { count: number }): ImageDecoder => async () => ({
  toJpeg: async () => blob,
  close: () => {
    closed.count += 1;
  },
});

test('JPEG, PNG and WebP are uploaded untouched and never decoded', async () => {
  let decoded = 0;
  const decode: ImageDecoder = async () => {
    decoded += 1;
    throw new Error('should not run');
  };
  for (const file of [fileOf('a.jpg', 'image/jpeg'), fileOf('b.png', 'image/png'), fileOf('c.webp', 'image/webp')]) {
    const prepared = await prepareUploadFile(file, decode);
    assert.equal(prepared.file, file);
    assert.equal(prepared.converted, false);
  }
  assert.equal(decoded, 0);
});

test('HEIC decoded by the browser becomes a JPEG with the same base name', async () => {
  const closed = { count: 0 };
  const prepared = await prepareUploadFile(fileOf('IMG_0042.HEIC', 'image/heic'), decoderYielding(new Blob([new Uint8Array(50)]), closed));
  assert.equal(prepared.converted, true);
  assert.equal(prepared.file.name, 'IMG_0042.jpg');
  assert.equal(prepared.file.type, 'image/jpeg');
  assert.equal(prepared.file.size, 50);
  assert.equal(closed.count, 1);
});

test('a HEIC with no media type is recognised by its extension', async () => {
  const prepared = await prepareUploadFile(fileOf('scan.heif', ''), decoderYielding(new Blob([new Uint8Array(10)]), { count: 0 }));
  assert.equal(prepared.converted, true);
});

test('where the browser cannot decode HEIC the original is uploaded as it is (D24 fallback)', async () => {
  const original = fileOf('IMG_1.heic', 'image/heic');
  const prepared = await prepareUploadFile(original, async () => {
    throw new Error('EncodingError');
  });
  assert.equal(prepared.file, original);
  assert.equal(prepared.converted, false);
});

test('an empty or failed encode keeps the original and still closes the image', async () => {
  const original = fileOf('IMG_1.heic', 'image/heic');
  for (const blob of [null, new Blob([])]) {
    const closed = { count: 0 };
    const prepared = await prepareUploadFile(original, decoderYielding(blob, closed));
    assert.equal(prepared.file, original);
    assert.equal(closed.count, 1);
  }
  const closed = { count: 0 };
  const failing: ImageDecoder = async () => ({
    toJpeg: async () => {
      throw new Error('canvas tainted');
    },
    close: () => {
      closed.count += 1;
    },
  });
  assert.equal((await prepareUploadFile(original, failing)).file, original);
  assert.equal(closed.count, 1);
});
