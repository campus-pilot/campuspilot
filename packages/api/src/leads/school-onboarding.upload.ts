import { hasExpectedImageSignature } from '@campuspilot/s3/image';
import Busboy from 'busboy';
import { Readable } from 'node:stream';

import { MAX_LOGO_BYTES, MAX_VOICE_NOTE_BYTES, SCHOOL_ONBOARDING_FIELDS } from './school-onboarding';

/**
 * Reading the School Onboarding form's multipart body: one `submission`
 * field (the answers as JSON) and at most one `logo` and one `voiceNote`
 * file. Each file's format is decided from its bytes alone; the file name
 * and the browser's declared type are never consulted.
 */

/** Largest `submission` field: 40 classes, each with every section and subject, fit well within it. */
export const MAX_SUBMISSION_FIELD_BYTES = 256 * 1024;
/** Largest whole body: both files at their caps, the answers and multipart framing. */
export const MAX_SCHOOL_ONBOARDING_BODY_BYTES = MAX_LOGO_BYTES + MAX_VOICE_NOTE_BYTES + MAX_SUBMISSION_FIELD_BYTES + 16 * 1024;

export type OnboardingFile = { bytes: Buffer; contentType: string; extension: string };

export type ParsedSchoolOnboardingUpload = {
  /** The `submission` field, parsed as JSON but not yet validated. */
  submission: unknown;
  logo: OnboardingFile | null;
  voiceNote: OnboardingFile | null;
};

/** A refusal of the body, with the HTTP status and code the route answers with. */
export class OnboardingUploadError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    readonly code: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE',
    message: string,
  ) {
    super(message);
    this.name = 'OnboardingUploadError';
  }
}

/** JPEG, PNG or WebP, from the bytes. */
export function sniffLogo(bytes: Uint8Array): Omit<OnboardingFile, 'bytes'> | null {
  if (hasExpectedImageSignature(bytes, 'image/jpeg')) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (hasExpectedImageSignature(bytes, 'image/png')) return { contentType: 'image/png', extension: 'png' };
  if (hasExpectedImageSignature(bytes, 'image/webp')) return { contentType: 'image/webp', extension: 'webp' };
  return null;
}

/** ISO base media brands that are still images (HEIC, AVIF), refused as voice notes. */
const IMAGE_BRANDS = new Set(['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis']);

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * WebM (EBML header), Ogg (`OggS`) or MP4 (`ftyp` box at offset 4, not an
 * image brand), from the bytes: what MediaRecorder writes in Chrome,
 * Firefox and Safari.
 */
export function sniffVoiceNote(bytes: Uint8Array): Omit<OnboardingFile, 'bytes'> | null {
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { contentType: 'audio/webm', extension: 'webm' };
  if (ascii(bytes, 0, 4) === 'OggS') return { contentType: 'audio/ogg', extension: 'ogg' };
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && !IMAGE_BRANDS.has(ascii(bytes, 8, 12).toLowerCase())) {
    return { contentType: 'audio/mp4', extension: 'm4a' };
  }
  return null;
}

/** What each file field accepts. */
const FILE_RULES = {
  [SCHOOL_ONBOARDING_FIELDS.logo]: {
    maxBytes: MAX_LOGO_BYTES,
    sniff: sniffLogo,
    tooLarge: `The logo must be ${MAX_LOGO_BYTES / 1024 / 1024} MB or smaller.`,
    unsupported: 'The logo must be a JPEG, PNG or WebP image.',
  },
  [SCHOOL_ONBOARDING_FIELDS.voiceNote]: {
    maxBytes: MAX_VOICE_NOTE_BYTES,
    sniff: sniffVoiceNote,
    tooLarge: `The voice note must be ${MAX_VOICE_NOTE_BYTES / 1024 / 1024} MB or smaller.`,
    unsupported: 'The voice note must be a WebM, Ogg or MP4 audio recording.',
  },
} as const;
type FileField = keyof typeof FILE_RULES;

function isFileField(name: string): name is FileField {
  return Object.hasOwn(FILE_RULES, name);
}

/**
 * Parses the body, bounded throughout: busboy stops at the larger file cap,
 * each file is held to its own cap while it streams, and the answers field
 * to {@link MAX_SUBMISSION_FIELD_BYTES}. Rejects with an
 * {@link OnboardingUploadError} for anything the form would never send.
 */
export function parseSchoolOnboardingUpload(request: Request): Promise<ParsedSchoolOnboardingUpload> {
  if (!request.body) return Promise.reject(new OnboardingUploadError(400, 'BAD_REQUEST', 'A multipart request body is required.'));

  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: Object.fromEntries(request.headers),
        // `files` and `fields` bound the parts. Busboy's own `parts` limit is not used: it fires on
        // reaching the limit, so it would refuse a request carrying exactly the answers and both files.
        limits: { fileSize: Math.max(MAX_LOGO_BYTES, MAX_VOICE_NOTE_BYTES), fieldSize: MAX_SUBMISSION_FIELD_BYTES, files: 2, fields: 1 },
      });
    } catch {
      reject(new OnboardingUploadError(400, 'BAD_REQUEST', 'A valid multipart/form-data request is required.'));
      return;
    }

    let submissionText: string | null = null;
    let refusal: OnboardingUploadError | null = null;
    const files = new Map<FileField, Promise<OnboardingFile>>();
    const refuse = (error: OnboardingUploadError) => {
      refusal ??= error;
    };

    parser.on('field', (name, value, info) => {
      if (name !== SCHOOL_ONBOARDING_FIELDS.submission) return refuse(new OnboardingUploadError(400, 'BAD_REQUEST', `Unknown field '${name}'.`));
      if (info.valueTruncated) return refuse(new OnboardingUploadError(413, 'PAYLOAD_TOO_LARGE', 'The answers are too long.'));
      submissionText = value;
    });

    parser.on('file', (name, stream) => {
      if (!isFileField(name) || files.has(name)) {
        stream.resume();
        return refuse(new OnboardingUploadError(400, 'BAD_REQUEST', `Unexpected file '${name}'.`));
      }
      const rule = FILE_RULES[name];
      const chunks: Buffer[] = [];
      let size = 0;
      const file = new Promise<OnboardingFile>((resolveFile, rejectFile) => {
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          // Keep draining past the cap so busboy can finish, but stop holding bytes.
          if (size <= rule.maxBytes) chunks.push(chunk);
        });
        stream.on('error', rejectFile);
        stream.on('end', () => {
          if (size > rule.maxBytes || stream.truncated) return rejectFile(new OnboardingUploadError(413, 'PAYLOAD_TOO_LARGE', rule.tooLarge));
          const bytes = Buffer.concat(chunks);
          const format = bytes.length > 0 ? rule.sniff(bytes) : null;
          if (!format) return rejectFile(new OnboardingUploadError(415, 'UNSUPPORTED_MEDIA_TYPE', rule.unsupported));
          resolveFile({ bytes, ...format });
        });
      });
      file.catch(() => {});
      files.set(name, file);
    });

    parser.on('filesLimit', () => refuse(new OnboardingUploadError(400, 'BAD_REQUEST', 'Send at most one logo and one voice note.')));
    parser.on('fieldsLimit', () => refuse(new OnboardingUploadError(400, 'BAD_REQUEST', 'Send the answers once.')));
    parser.on('error', () => reject(new OnboardingUploadError(400, 'BAD_REQUEST', 'The multipart body could not be read.')));
    parser.on('finish', async () => {
      try {
        if (refusal) throw refusal;
        if (submissionText === null) throw new OnboardingUploadError(400, 'BAD_REQUEST', 'The answers are missing.');
        let submission: unknown;
        try {
          submission = JSON.parse(submissionText);
        } catch {
          throw new OnboardingUploadError(400, 'BAD_REQUEST', 'The answers are not JSON.');
        }
        const logo = (await files.get(SCHOOL_ONBOARDING_FIELDS.logo)) ?? null;
        const voiceNote = (await files.get(SCHOOL_ONBOARDING_FIELDS.voiceNote)) ?? null;
        resolve({ submission, logo, voiceNote });
      } catch (error) {
        reject(error);
      }
    });

    Readable.from(request.body as AsyncIterable<Uint8Array>).pipe(parser);
  });
}
