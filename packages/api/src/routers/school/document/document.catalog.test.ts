import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_MARKETPLACE,
  SAMPLE_DOCUMENT_CONTEXT,
} from './document.catalog';
import { renderDocument } from './document.render';

describe('document template marketplace', () => {
  it('offers the legacy catalog plus matching statement designs', () => {
    const expected = {
      report_card: ['default', 'default-attendance', 'minimal'],
      id_card: ['default', 'modern', 'minimal', 'classic'],
      admit_card: ['default', 'with-timetable', 'minimal'],
      timetable: ['default', 'centered'],
      bill: ['default', 'compact', 'default-full'],
      receipt: ['default', 'compact', 'default-full'],
      statement: ['default', 'compact', 'default-full'],
    } as const;
    for (const [documentType, variants] of Object.entries(expected)) {
      const items = DOCUMENT_MARKETPLACE.filter(
        (item) => item.documentType === documentType,
      );
      expect(items.map((item) => item.slug)).toEqual(
        variants.map((variant) => `${documentType}-${variant}`),
      );
      for (const item of items) {
        expect(item.content).toContain('school.logoUrl');
        expect(item.content).toContain('alt="School logo"');
      }
    }
  });

  it('marks only supported legacy finance and admit-card designs as half A4', () => {
    const half = DOCUMENT_MARKETPLACE.filter(
      (item) => item.pageSize === 'half',
    ).map((item) => item.slug);
    expect(half).toEqual([
      'admit_card-default',
      'admit_card-with-timetable',
      'admit_card-minimal',
      'bill-default',
      'bill-compact',
      'receipt-default',
      'receipt-compact',
      'statement-default',
      'statement-compact',
    ]);
  });

  it('keeps marketplace slugs unique', () => {
    const slugs = DOCUMENT_MARKETPLACE.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('renders every imported design with the current documented context', () => {
    for (const item of DOCUMENT_MARKETPLACE) {
      const html = renderDocument(item.content, SAMPLE_DOCUMENT_CONTEXT);
      expect(html, item.slug).toContain('Greenwood Public School');
      expect(html, item.slug).not.toContain('{{');
    }
  });

  it('adapts legacy report tables to the current independent mode-mark flag', () => {
    for (const item of DOCUMENT_MARKETPLACE.filter(
      ({ documentType }) => documentType === 'report_card',
    )) {
      expect(item.content, item.slug).toContain(
        'reportSections.includeModeMarks',
      );
    }
    for (const slug of [
      'report_card-default',
      'report_card-default-attendance',
    ]) {
      const content = DOCUMENT_MARKETPLACE.find(
        (item) => item.slug === slug,
      )!.content;
      expect(content, slug).toContain(
        'reportSections.includeCoScholastics',
      );
      expect(content, slug).toContain('reportSections.includeGradingScale');
    }
  });
});
