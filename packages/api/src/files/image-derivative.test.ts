import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ORPCError } from '@orpc/server';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { makeImageDerivatives, normalizeFigureImage } from './image-derivative';

/**
 * A real HEVC still in a HEIC container (64x48, brand `heic`): the stream was
 * encoded by libx265 and wrapped in the HEIF boxes (ftyp, meta with hvcC,
 * ispe, iloc, mdat). It is 545 bytes and has no personal content.
 */
const HEVC_STILL = readFileSync(new URL('./__fixtures__/hevc-still.heic', import.meta.url));

/** A noisy RGB photo-like image; noise does not compress, so it exercises the size loop. */
function noisyImage(width: number, height: number) {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } });
}

describe('makeImageDerivatives', () => {
  it('makes a bounded model JPEG and a thumbnail, and reports the displayed size', async () => {
    const jpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#ccc' } }).jpeg().toBuffer();
    const result = await makeImageDerivatives(jpeg, 'image/jpeg');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result).toMatchObject({ width: 3000, height: 2000 });
    const model = await sharp(result.model.bytes).metadata();
    expect(model).toMatchObject({ format: 'jpeg', width: 1800, height: 1200 });
    const thumb = await sharp(result.thumb.bytes).metadata();
    expect(thumb).toMatchObject({ format: 'jpeg', width: 360, height: 240 });
  });

  it('never enlarges a small image', async () => {
    const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
    const result = await makeImageDerivatives(png, 'image/png');
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(await sharp(result.model.bytes).metadata()).toMatchObject({ width: 200, height: 100 });
  });

  it('applies EXIF orientation: a rotated phone photo is upright in both derivatives and in the reported size', async () => {
    // Orientation 6 = rotate 90 degrees clockwise to display: stored 400x200 shows as 200x400.
    const jpeg = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#888' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const result = await makeImageDerivatives(jpeg, 'image/jpeg');
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result).toMatchObject({ width: 200, height: 400 });
    expect(await sharp(result.model.bytes).metadata()).toMatchObject({ width: 200, height: 400 });
  });

  it('flattens transparency onto white', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const result = await makeImageDerivatives(png, 'image/png');
    if (result.status !== 'ready') throw new Error('expected ready');
    const { data } = await sharp(result.model.bytes).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)].every((channel) => channel > 250)).toBe(true);
  });

  it('shrinks an incompressible photo until the model copy is small', async () => {
    const jpeg = await noisyImage(2400, 1800).jpeg({ quality: 95 }).toBuffer();
    const result = await makeImageDerivatives(jpeg, 'image/jpeg');
    if (result.status !== 'ready') throw new Error('expected ready');
    // Noise at 1300 px / q55 is the floor; it is stored whatever its size, but
    // far below the 15 MB original and the 5 MB provider limit.
    expect(result.model.bytes.byteLength).toBeLessThan(5 * 1024 * 1024);
    const { width, height } = await sharp(result.model.bytes).metadata();
    expect(Math.max(width!, height!)).toBeLessThanOrEqual(1800);
  });

  it('refuses a JPEG, PNG or WebP that cannot be decoded with 415', async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      const error = await makeImageDerivatives(broken, type).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ORPCError);
      expect((error as ORPCError<string, unknown>).status).toBe(415);
    }
  });
});

describe('HEIC (design U3)', () => {
  /**
   * U3 asked whether sharp 0.34.5 rejects HEIC. Measured answer: its header
   * (`metadata()`) is READ fine (format heif, compression hevc, size), but the
   * prebuilt libheif has no HEVC decoder, so DECODING fails. That is why
   * `makeImageDerivatives` decides by decoding, and why `unsupported` keeps
   * the header's width and height.
   */
  it('reads the header but cannot decode the pixels', async () => {
    expect(await sharp(HEVC_STILL).metadata()).toMatchObject({ format: 'heif', compression: 'hevc', width: 64, height: 48 });
    await expect(sharp(HEVC_STILL).jpeg().toBuffer()).rejects.toThrow(/compression format has not been built in/);
  });

  it('stores an undecodable HEIC as unsupported, with the size its header states and no derivatives', async () => {
    for (const type of ['image/heic', 'image/heif']) {
      expect(await makeImageDerivatives(HEVC_STILL, type)).toEqual({ status: 'unsupported', width: 64, height: 48 });
    }
  });

  it('marks HEIC bytes that are not an image at all as unsupported with no size', async () => {
    const notAnImage = Buffer.concat([HEVC_STILL.subarray(0, 40), randomBytes(200)]);
    expect(await makeImageDerivatives(notAnImage, 'image/heic')).toEqual({ status: 'unsupported', width: null, height: null });
  });
});

describe('normalizeFigureImage', () => {
  it('bounds a photo to 1400 px as JPEG', async () => {
    const jpeg = await noisyImage(2000, 1000).jpeg({ quality: 90 }).toBuffer();
    const figure = await normalizeFigureImage(jpeg);
    expect(figure).toMatchObject({ contentType: 'image/jpeg', extension: 'jpg', width: 1400, height: 700 });
  });

  it('keeps a small transparent PNG as a PNG', async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
    expect(await normalizeFigureImage(png)).toMatchObject({ contentType: 'image/png', extension: 'png', width: 100, height: 100 });
  });

  it('refuses bytes that are not an image with 415', async () => {
    const error = await normalizeFigureImage(randomBytes(100)).catch((e: unknown) => e);
    expect((error as ORPCError<string, unknown>).status).toBe(415);
  });
});
