import { describe, expect, it } from 'vitest';
import { DOCUMENT_MARKETPLACE } from './document.catalog';

describe('document template marketplace', () => {
  it('offers four branded designs for every supported document type', () => {
    for (const documentType of [
      'report_card',
      'id_card',
      'admit_card',
      'timetable',
      'bill',
      'receipt',
      'statement',
    ] as const) {
      const items = DOCUMENT_MARKETPLACE.filter(
        (item) => item.documentType === documentType,
      );
      expect(items.map((item) => item.slug)).toEqual([
        `${documentType}-modern`,
        `${documentType}-classic`,
        `${documentType}-minimal`,
        `${documentType}-crest`,
      ]);
      for (const item of items) {
        expect(item.content).toContain('school.logoUrl');
        expect(item.content).toContain('class="logo"');
      }
    }
  });

  it('keeps marketplace slugs unique', () => {
    const slugs = DOCUMENT_MARKETPLACE.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
