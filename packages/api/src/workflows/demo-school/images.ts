import { deflateSync } from 'node:zlib';

import type { Random } from './prng';

/**
 * Illustrated demo images (plan §5 `images/`, §13 Q1): flat, geometric avatars
 * and a monogram logo drawn procedurally into PNGs. They contain no real faces
 * and no third-party artwork, need no committed binaries, and are reproducible
 * from the seed. PNG is used because the upload validators accept only JPEG,
 * PNG and WebP (`@campuspilot/s3/image`).
 */

type Rgb = readonly [number, number, number];

class Canvas {
  readonly pixels: Uint8Array;
  /** `height` defaults to `width`: the avatars and the logo are square, a paper page is not. */
  constructor(readonly width: number, background: Rgb, readonly height: number = width) {
    this.pixels = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      this.pixels.set([background[0], background[1], background[2], 255], index * 4);
    }
  }

  /** Blends `color` into a pixel with coverage `alpha` in [0, 1]. */
  private blend(x: number, y: number, color: Rgb, alpha: number) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 4;
    const a = Math.min(1, alpha);
    for (let channel = 0; channel < 3; channel += 1) {
      this.pixels[offset + channel] = Math.round(this.pixels[offset + channel]! * (1 - a) + color[channel]! * a);
    }
  }

  /** Fills a shape given its signed distance function (negative inside), anti-aliased over one pixel. */
  fill(distance: (x: number, y: number) => number, color: Rgb) {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        this.blend(x, y, color, 0.5 - distance(x + 0.5, y + 0.5));
      }
    }
  }

  rect(x: number, y: number, width: number, height: number, color: Rgb) {
    for (let row = Math.max(0, Math.floor(y)); row < Math.min(this.height, Math.ceil(y + height)); row += 1) {
      for (let column = Math.max(0, Math.floor(x)); column < Math.min(this.width, Math.ceil(x + width)); column += 1) {
        this.blend(column, row, color, 1);
      }
    }
  }

  /** An anti-aliased disc, touching only the pixels around it (unlike {@link fill}, which visits the whole canvas). */
  dot(cx: number, cy: number, radius: number, color: Rgb) {
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y += 1) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x += 1) {
        this.blend(x, y, color, 0.5 - (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius));
      }
    }
  }

  /**
   * Ruled notebook paper: evenly spaced pale blue rules and a red margin
   * line, the way a school exercise book looks in a photo.
   */
  ruledPaper(options: { top: number; spacing: number; marginX: number }) {
    for (let y = options.top; y < this.height - options.spacing / 2; y += options.spacing) {
      this.rect(0, y, this.width, 1.5, [186, 210, 236]);
    }
    this.rect(options.marginX, 0, 2, this.height, [226, 136, 136]);
  }

  /**
   * A line of pen "handwriting": a wavy stroke with a varying height that
   * breaks into word-sized runs. It reads as writing at thumbnail size and
   * carries no text, so the demo has nothing to copy from or to translate.
   */
  scribbleLine(random: Random, options: { x: number; y: number; length: number; ink: Rgb; height: number }) {
    let cursor = options.x;
    const end = options.x + options.length;
    while (cursor < end) {
      const wordLength = Math.min(end - cursor, random.int(18, 70));
      const phase = random.next() * Math.PI * 2;
      const frequency = 0.2 + random.next() * 0.3;
      const lift = options.height * (0.35 + random.next() * 0.5);
      let previous: number | null = null;
      for (let step = 0; step < wordLength; step += 1) {
        const x = cursor + step;
        const letter = Math.sin(x * frequency + phase) * lift;
        const drift = Math.sin(x * 0.05 + phase) * 0.9;
        const y = options.y - options.height / 2 + letter + drift;
        // Join this column to the previous one so a steep stroke is one line, not a row of dots.
        const from: number = previous ?? y;
        const steps = Math.max(1, Math.ceil(Math.abs(y - from)));
        for (let part = 1; part <= steps; part += 1) this.dot(x, from + ((y - from) * part) / steps, 1.15, options.ink);
        previous = y;
      }
      cursor += wordLength + random.int(7, 14);
    }
  }

  /** A hollow rectangle with a line `thickness` wide. */
  frame(x: number, y: number, width: number, height: number, thickness: number, color: Rgb) {
    this.rect(x, y, width, thickness, color);
    this.rect(x, y + height - thickness, width, thickness, color);
    this.rect(x, y, thickness, height, color);
    this.rect(x + width - thickness, y, thickness, height, color);
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.pixels);
  }
}

const circle = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) - r;
const ellipse = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) => {
  const k = Math.hypot((x - cx) / rx, (y - cy) / ry);
  return (k - 1) * Math.min(rx, ry);
};
const below = (shape: (x: number, y: number) => number, limit: number) => (x: number, y: number) =>
  Math.max(shape(x, y), limit - y);
const above = (shape: (x: number, y: number) => number, limit: number) => (x: number, y: number) =>
  Math.max(shape(x, y), y - limit);
const roundedSquare = (inset: number, size: number, radius: number) => (x: number, y: number) => {
  const half = size / 2 - inset;
  const qx = Math.abs(x - size / 2) - (half - radius);
  const qy = Math.abs(y - size / 2) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
};

const BACKGROUNDS: Rgb[] = [[219, 234, 254], [220, 252, 231], [254, 243, 199], [252, 231, 243], [237, 233, 254], [204, 251, 241], [255, 237, 213]];
const SKIN: Rgb[] = [[244, 204, 170], [231, 180, 141], [205, 145, 104], [176, 116, 79], [141, 90, 60]];
const HAIR: Rgb[] = [[38, 28, 24], [62, 42, 30], [24, 24, 28], [88, 58, 38]];
const CLOTHES: Rgb[] = [[37, 99, 235], [22, 163, 74], [220, 38, 38], [147, 51, 234], [234, 88, 12], [8, 145, 178], [71, 85, 105]];

export type AvatarStyle = 'child' | 'adult';
export type AvatarGender = 'female' | 'male';

/** A 256×256 illustrated portrait chosen deterministically from `random`. */
export function renderAvatar(random: Random, options: { style: AvatarStyle; gender: AvatarGender }): Buffer {
  const size = 256;
  const canvas = new Canvas(size, random.pick(BACKGROUNDS));
  const skin = random.pick(SKIN);
  const hair = random.pick(HAIR);
  const clothes = random.pick(CLOTHES);
  const headRadius = options.style === 'child' ? 58 : 52;
  const headY = options.style === 'child' ? 112 : 104;

  // Shoulders, neck, then head.
  canvas.fill(below(ellipse(128, 262, 104, 78), 180), clothes);
  canvas.rect(112, headY + headRadius - 12, 32, 34, skin);
  if (options.gender === 'female') {
    // Shoulder-length hair framing the face, ending above the chin.
    canvas.fill(above(ellipse(128, headY + 4, headRadius + 14, headRadius + 24), headY + 30), hair);
  }
  canvas.fill(circle(128, headY, headRadius), skin);
  // Hair cap over the top of the head.
  canvas.fill(above(circle(128, headY - 6, headRadius + 4), headY - headRadius / 3), hair);
  if (options.gender === 'female' && random.chance(0.4)) {
    canvas.fill(circle(128, headY - headRadius - 10, 22), hair);
  }
  // Ears.
  canvas.fill(circle(128 - headRadius, headY + 6, 10), skin);
  canvas.fill(circle(128 + headRadius, headY + 6, 10), skin);
  // Eyes and smile.
  const dark: Rgb = [33, 33, 33];
  canvas.fill(circle(108, headY + 6, 5.5), dark);
  canvas.fill(circle(148, headY + 6, 5.5), dark);
  const smile = (x: number, y: number) => Math.max(Math.abs(Math.hypot(x - 128, y - (headY + 10)) - 22) - 2.5, headY + 22 - y);
  canvas.fill(smile, [150, 62, 62]);
  if (options.style === 'adult' && options.gender === 'male' && random.chance(0.35)) {
    canvas.fill(below(ellipse(128, headY + 40, 30, 16), headY + 34), hair);
  }
  if (options.style === 'adult' && random.chance(0.3)) {
    // Spectacles.
    const ring = (cx: number) => (x: number, y: number) => Math.abs(Math.hypot(x - cx, y - (headY + 6)) - 13) - 2;
    canvas.fill(ring(108), dark);
    canvas.fill(ring(148), dark);
    canvas.rect(121, headY + 4, 14, 3, dark);
  }
  return canvas.toPng();
}

/** 5×7 bitmap capitals for logo monograms. */
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};

/** Up to three initials from the school name's words, ignoring non-letters. */
export function monogramInitials(name: string): string {
  const initials = name
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)
    .map((word) => word[0]!)
    .join('');
  return (initials || 'S').slice(0, 3);
}

/** A 512×512 monogram logo used when the admin uploads no logo. */
export function renderMonogramLogo(random: Random, schoolName: string): Buffer {
  const size = 512;
  const canvas = new Canvas(size, [255, 255, 255]);
  const color = random.pick(CLOTHES);
  canvas.fill(roundedSquare(16, size, 96), color);
  const initials = monogramInitials(schoolName);
  const scale = initials.length === 1 ? 40 : initials.length === 2 ? 30 : 22;
  const glyphWidth = 5 * scale;
  const gap = scale;
  const totalWidth = initials.length * glyphWidth + (initials.length - 1) * gap;
  const startX = (size - totalWidth) / 2;
  const startY = (size - 7 * scale) / 2;
  for (const [position, letter] of [...initials].entries()) {
    const glyph = GLYPHS[letter] ?? GLYPHS.S!;
    for (const [row, bits] of glyph.entries()) {
      for (const [column, bit] of [...bits].entries()) {
        if (bit === '1') {
          canvas.rect(startX + position * (glyphWidth + gap) + column * scale, startY + row * scale, scale, scale, [255, 255, 255]);
        }
      }
    }
  }
  return canvas.toPng();
}

/** What one photographed page of a demo question paper shows. */
export type PaperPageSpec = {
  /** Lines of handwriting, top to bottom. */
  lines: number;
  /** Whether a hand-drawn diagram box sits in the lower part of the page. */
  figureBox: boolean;
};

const PAPER: Rgb = [253, 251, 243];
const INK: Rgb = [38, 52, 128];

/**
 * A synthetic 640×900 "photo" of a handwritten question paper page: ruled
 * paper, a heading scribble, `lines` lines of pen strokes with ragged ends
 * and optionally a diagram box with a drawn circle in it. Illustrative only
 * (D33): it holds no text and no real handwriting, so nothing in it can be
 * read back, and it is deterministic for the same `random`.
 */
export function renderPaperPage(random: Random, spec: PaperPageSpec): Buffer {
  const width = 640;
  const height = 900;
  const canvas = new Canvas(width, PAPER, height);
  const spacing = 34;
  const left = 74;
  canvas.ruledPaper({ top: 96, spacing, marginX: 58 });
  // Heading: a short, taller scribble centred on the first rule.
  canvas.scribbleLine(random, { x: 190, y: 74, length: 260, ink: INK, height: 18 });
  const figureTop = 560;
  const figureHeight = 190;
  for (let line = 0; line < spec.lines; line += 1) {
    const y = 96 + (line + 1) * spacing - 6;
    if (y > height - 40) break;
    if (spec.figureBox && y > figureTop - 8 && y < figureTop + figureHeight + 12) continue;
    // Question numbers start a line short of the margin; answers run to a ragged edge.
    const length = width - left - 36 - random.int(0, 190);
    canvas.scribbleLine(random, { x: left, y, length, ink: INK, height: 14 });
  }
  if (spec.figureBox) {
    canvas.frame(left, figureTop, width - left - 40, figureHeight, 2, INK);
    const cx = left + (width - left - 40) / 2;
    const cy = figureTop + figureHeight / 2;
    canvas.fill((x, y) => Math.abs(Math.hypot(x - cx, y - cy) - 58) - 1.5, INK);
    canvas.rect(cx - 58, cy, 116, 2, INK);
    canvas.rect(cx, cy - 58, 2, 58, INK);
  }
  return canvas.toPng();
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, crc]);
}

/** Minimal truecolour-with-alpha PNG encoder (filter 0, zlib-deflated). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + row * width * 4, width * 4).copy(raw, row * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}
