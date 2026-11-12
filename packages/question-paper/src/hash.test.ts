import { describe, expect, it } from 'vitest';

import { canonicalQuestionPaperHtml, questionPaperContentSha256, questionPaperDraftId } from './hash';
import { sha256Hex } from './sha256';

describe('fragment hashing', () => {
  it('normalises to NFC, LF line ends and no surrounding whitespace', () => {
    // "क़" typed as क + nukta composes to U+0958? NFC keeps the canonical composition exclusion, so use é.
    const decomposed = 'é';
    expect(canonicalQuestionPaperHtml(`  <p>${decomposed}</p>\r\n<p>b</p>\r `)).toBe('<p>é</p>\n<p>b</p>');
  });

  it('hashes the canonical form, so equivalent text has one hash and one draft id', () => {
    const a = '<p>é</p>\r\n';
    const b = '<p>é</p>';
    expect(questionPaperContentSha256(a)).toBe(questionPaperContentSha256(b));
    expect(questionPaperContentSha256(a)).toBe(sha256Hex('<p>é</p>'));
    expect(questionPaperDraftId(a)).toBe(questionPaperContentSha256(a).slice(0, 12));
    expect(questionPaperDraftId(a)).toHaveLength(12);
  });

  it('gives different text a different id', () => {
    expect(questionPaperDraftId('<p>a</p>')).not.toBe(questionPaperDraftId('<p>b</p>'));
  });
});
