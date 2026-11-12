import { sha256Hex } from './sha256';

/**
 * The stored form of a fragment: Unicode NFC, `\n` line ends and no
 * surrounding whitespace. NFC is idempotent, so normalising twice changes
 * nothing; it is applied before hashing so the stored paper and the draft id
 * of the same text always agree (a Hindi text typed with decomposed
 * characters hashes like the composed one).
 */
export function canonicalQuestionPaperHtml(html: string): string {
  return html.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

/** Full SHA-256 of the canonical fragment; stored as `content_sha256`. */
export function questionPaperContentSha256(html: string): string {
  return sha256Hex(canonicalQuestionPaperHtml(html));
}

/**
 * The identifier of a draft: the first 12 hex characters of the content hash
 * of the fragment as the model wrote it (before sanitising). A draft is not a
 * database row; this id lets a chat agent save "the draft you just validated"
 * without re-sending thousands of tokens.
 */
export function questionPaperDraftId(html: string): string {
  return questionPaperContentSha256(html).slice(0, 12);
}

/** What the sanitiser took out or changed, one line per kind (shown to the user, stored with the version). */
export type QuestionPaperNotice = { code: string; message: string };
