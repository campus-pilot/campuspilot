import { randomBytes } from 'node:crypto';

const PREFIXES = {
  approval: 'asa',
  conversation: 'asc',
  item: 'asi',
  run: 'asr',
} as const;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Prefixed random ids in the platform's `<prefix>_<21 base-36 chars>` shape. */
export function generateId(entity: keyof typeof PREFIXES): string {
  const bytes = randomBytes(21);
  let suffix = '';
  for (const byte of bytes) suffix += ALPHABET[byte % ALPHABET.length];
  return `${PREFIXES[entity]}_${suffix}`;
}
