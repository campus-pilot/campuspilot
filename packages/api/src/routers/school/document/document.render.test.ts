import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  combineDocuments,
  convertDocumentPdf,
  renderDocument,
} from './document.render';

describe('document rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders values with a restrictive CSP and HTML escaping', () => {
    const html = renderDocument('<h1>{{name}}</h1>', {
      name: '<script>unsafe()</script>',
    });

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain(
      '&lt;script&gt;unsafe()&lt;/script&gt;',
    );
    expect(html).not.toContain('<script>');
  });

  it('removes active markup, event handlers, and external images', () => {
    const html = renderDocument(
      '<script>alert(1)</script><p onclick="alert(2)">Safe</p><img src="https://example.com/a.png">',
      {},
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('https://example.com');
    expect(html).toContain('<p>Safe</p>');
  });

  it.each(['png', 'jpeg', 'webp'])(
    'retains a base64 %s data image',
    (format) => {
      const html = renderDocument(
        `<img src="data:image/${format};base64,AAAA" alt="Photo">`,
        {},
      );

      expect(html).toContain(`data:image/${format};base64,AAAA`);
      expect(html).toContain('alt="Photo"');
    },
  );

  it('supports the bounded numeric add helper', () => {
    expect(renderDocument('{{add columns 1}}', { columns: 3 })).toContain(
      '<body>4</body>',
    );
  });

  it.each([
    ['{{add value 1}}', { value: '3' }],
    ['{{add value 1}}', { value: Number.POSITIVE_INFINITY }],
    ['{{unknown value}}', { value: 1 }],
    ['{{#if value}}', { value: true }],
  ])('maps invalid or unsupported templates to BAD_REQUEST', (template, context) => {
    expect(() => renderDocument(template, context)).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message:
          'The template contains invalid Handlebars syntax or an unsupported helper.',
      }),
    );
  });

  it('uses an A4 grid for ID card batches', () => {
    const html = combineDocuments(['<p>One</p>', '<p>Two</p>'], 'id_card');

    expect(html).toContain('@page{size:A4;');
    expect(html).toContain('grid-template-columns:86mm 86mm');
    expect(html.match(/class="sheet-item"/g)).toHaveLength(2);
  });

  it('packs half-A4 templates two-up and starts the third document on a new sheet', () => {
    const html = combineDocuments(
      ['<p>One</p>', '<p>Two</p>', '<p>Three</p>'],
      'receipt',
      'half',
    );

    expect(html).toContain('grid-template-rows:148.5mm 148.5mm');
    expect(html.match(/class="print-sheet"/g)).toHaveLength(2);
    expect(html.match(/class="sheet-item"/g)).toHaveLength(3);
  });

  it('uses landscape pages for timetables and page breaks for reports', () => {
    expect(combineDocuments(['Timetable'], 'timetable')).toContain(
      '@page{size:A4 landscape;',
    );
    expect(combineDocuments(['Report'], 'report_card')).toContain(
      'break-after:page',
    );
  });

  it('sanitizes each document while combining a batch', () => {
    const html = combineDocuments(
      ['<p onclick="unsafe()">Safe</p><script>unsafe()</script>'],
      'report_card',
    );

    expect(html).toContain('<p>Safe</p>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
  });

  it('rejects batches beyond the rendering byte limit before wrapping them', () => {
    expect(() =>
      combineDocuments(['x'.repeat(25_000_001)], 'report_card'),
    ).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message:
          'This document exceeds the 25 MB rendering limit. Select fewer students or use smaller photos.',
      }),
    );
  });

  it.each([
    ['timetable', '11.7', '8.27'],
    ['report_card', '8.27', '11.7'],
  ] as const)(
    'sends %s HTML to the converter with the intended paper orientation',
    async (type, width, height) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('%PDF-1.7\nvalid', { status: 200 }),
      );

      await expect(convertDocumentPdf('<p>Document</p>', type)).resolves.toEqual(
        Buffer.from('%PDF-1.7\nvalid'),
      );
      const [, init] = fetchMock.mock.calls[0]!;
      const form = init?.body as FormData;
      expect(form.get('paperWidth')).toBe(width);
      expect(form.get('paperHeight')).toBe(height);
      expect(form.get('preferCssPageSize')).toBe('true');
      expect(form.get('printBackground')).toBe('true');
      expect(form.get('files')).toBeInstanceOf(Blob);
    },
  );

  it('rejects failed and malformed converter responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('unavailable', { status: 503 }),
    );
    await expect(
      convertDocumentPdf('<p>Document</p>', 'report_card'),
    ).rejects.toThrow('PDF conversion failed (503).');

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('not a pdf', { status: 200 }),
    );
    await expect(
      convertDocumentPdf('<p>Document</p>', 'report_card'),
    ).rejects.toThrow('PDF converter returned an invalid or oversized document.');
  });
});
