import { EXAMPLE_ENGLISH_SCIENCE_HTML, EXAMPLE_HINDI_MATH_HTML } from '@campuspilot/question-paper/examples';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_MARKETPLACE, SAMPLE_QUESTION_PAPER_CONTEXT } from '../document/document.catalog';
import type { FigureAssets } from './question-paper.body';
import { dataUriImage, imageSizeOf } from './question-paper.docx-images';
import { mathHtml, questionPaperDocxHtml } from './question-paper.docx-html';
import { renderQuestionPaperTemplate, renderStandaloneQuestionPaperShell } from './question-paper.render';

/** A valid 1x1 PNG. */
const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const QPF = 'qpf_0123456789abcdefghijk';
const design = (slug: string) => DOCUMENT_MARKETPLACE.find((entry) => entry.documentType === 'question_paper' && entry.slug === slug)!.content;
const SHELL = renderStandaloneQuestionPaperShell();

/** The fragment converted inside the plain shell (no heading, no footer), so the output is the body alone. */
const convert = (fragment: string, figures: FigureAssets = new Map()) => questionPaperDocxHtml({ fragment, figures, template: SHELL });
const bodyOf = (html: string) => html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));

describe('Word conversion: layout', () => {
  it('turns a flex row into a borderless table, the marks of a space-between row aligned right', () => {
    const result = convert(
      '<style>.q{display:flex;justify-content:space-between}.q .main{flex:1}</style><div class="q"><span>1</span><div class="main">Name a gas.</div><span>[2]</span></div>',
    );
    expect(result.tables).toEqual([{ kind: 'layout', indent: 0, rtl: false, ruleAbove: false, ruleBelow: false }]);
    const body = bodyOf(result.html);
    expect(body).toMatch(/^<table><colgroup>(<col width="[\d.]+%">){3}<\/colgroup><tbody><tr><td>/);
    expect(body).toContain('<td style="text-align:right"><div custom-style="QP Right"><p>[2]</p></div></td>');
    expect(body).toContain('Name a gas.');
  });

  it('turns a grid of N columns into a table of N columns, filled row by row', () => {
    const result = convert(
      '<style>.opts{display:grid;grid-template-columns:repeat(2,1fr)}</style><div class="opts"><span>(a) one</span><span>(b) two</span><span>(c) three</span></div>',
    );
    const body = bodyOf(result.html);
    expect(body.match(/<col width="50\.0%">/g)).toHaveLength(2);
    expect(body.match(/<tr>/g)).toHaveLength(2);
    expect(body).toContain('<td><p>(c) three</p></td><td></td>');
  });

  it('keeps a flex column as ordinary paragraphs', () => {
    const result = convert('<div style="display:flex;flex-direction:column"><p>one</p><p>two</p></div>');
    expect(result.tables).toEqual([]);
    expect(bodyOf(result.html)).toBe('<p>one</p><p>two</p>');
  });

  it('turns an empty box with only a bottom line into a blank of underscores as wide as the box', () => {
    const body = bodyOf(convert('<p>The capital is <span style="display:inline-block;width:35mm;border-bottom:1px solid #000"></span>.</p>').html);
    const blank = /The capital is (_+)\./.exec(body)?.[1];
    expect(blank).toBeDefined();
    expect(blank!.length).toBe(19);
  });

  it('turns a fully bordered block into a one-cell box and a figure placeholder into a labelled box', () => {
    const result = convert('<div style="border:1px solid #000">Word bank: sun, moon</div><figure data-placeholder="A labelled heart &amp; lungs"></figure>');
    expect(result.tables.map((table) => table.kind)).toEqual(['box', 'box']);
    const body = bodyOf(result.html);
    expect(body).toContain('<td><p>Word bank: sun, moon</p></td>');
    expect(body).toContain('<em>Figure to be added</em>');
    expect(body).toContain('A labelled heart &amp; lungs');
  });

  it('keeps an authored table with its spans; it is lined when a cell draws a line (the default sheet gives cells one)', () => {
    const result = convert('<table><tbody><tr><th colspan="2">Marks</th></tr><tr><td>A</td><td>B</td></tr></tbody></table>');
    expect(result.tables).toEqual([{ kind: 'data', indent: 0, rtl: false, ruleAbove: false, ruleBelow: false }]);
    const body = bodyOf(result.html);
    expect(body).toContain('<td colspan="2"><p><strong>Marks</strong></p></td>');
    const unlined = convert('<style>.plain td,.plain th{border:none}</style><table class="plain"><tbody><tr><td>A</td></tr></tbody></table>');
    expect(unlined.tables[0]!.kind).toBe('layout');
  });

  it('records tables outer before inner, the order Pandoc writes them', () => {
    const result = convert(
      '<style>.q{display:flex}.opts{display:grid;grid-template-columns:1fr 1fr}</style><div style="border:1px solid #000"><div class="q"><span>1</span><div><div class="opts"><span>a</span><span>b</span></div></div></div></div>',
    );
    expect(result.tables.map((table) => table.kind)).toEqual(['box', 'layout', 'layout']);
  });

  it('keeps a rule drawn along a layout row as that table’s border', () => {
    const result = convert('<div style="display:flex;justify-content:space-between;border-top:1px solid #000;border-bottom:1px solid #000"><span>Time</span><span>Marks</span></div>');
    expect(result.tables[0]).toMatchObject({ ruleAbove: true, ruleBelow: true });
  });

  it('lays an inline element that wraps blocks out as a block, keeping its formatting (a struck-out question)', () => {
    const body = bodyOf(convert('<del><div>Question one</div><div>Question two</div></del>').html);
    expect(body).toBe('<p><s>Question one</s></p><p><s>Question two</s></p>');
  });

  it('indents by margin and keeps alignment as named paragraph styles', () => {
    const body = bodyOf(convert('<div style="margin-left:6mm">Indented</div><p style="text-align:center">Centred</p><h2>Section A</h2>').html);
    expect(body).toContain('<div custom-style="QP Indent 1"><p>Indented</p></div>');
    expect(body).toContain('<div custom-style="QP Center"><p>Centred</p></div>');
    expect(body).toContain('<div custom-style="QP Heading 2"><p><strong>Section A</strong></p></div>');
  });
});

describe('Word conversion: formulas and text', () => {
  it('writes an inline formula as \\( \\) and a displayed one as \\[ \\]', () => {
    const body = bodyOf(convert('<p>Solve <span data-math="x^2=4"></span>.</p><p><span data-math="\\frac{a}{b}" data-display="true"></span></p>').html);
    expect(body).toContain('Solve \\(x^2=4\\).');
    expect(body).toContain('\\[\\frac{a}{b}\\]');
  });

  it('can never turn a teacher’s literal \\( or \\[ into a formula: every backslash of text is a span of its own', () => {
    const body = bodyOf(convert('<p>Type \\(x\\) or \\[y\\] to write maths.</p>').html);
    expect(body).toBe('<p>Type <span>\\</span>(x<span>\\</span>) or <span>\\</span>[y<span>\\</span>] to write maths.</p>');
    expect(body).not.toMatch(/\\[([]/);
  });

  it('moves a bare operator at either end of a formula out as text, so no editor shows an empty operand', () => {
    expect(mathHtml('325+0=', false).html).toBe('\\(325+0\\)=');
    expect(mathHtml('7 \\times', false).html).toBe('\\(7\\)×');
    expect(mathHtml('= 42', false).html).toBe('=\\(42\\)');
    expect(mathHtml('-5+3', false).html).toBe('\\(-5+3\\)');
    expect(mathHtml('\\left(x\\right)', false).html).toBe('\\(\\left(x\\right)\\)');
    expect(mathHtml('a \\ne', false).html).toBe('\\(a\\)≠');
  });

  it('shows a formula that holds a delimiter of its own as text, so it cannot end the equation early', () => {
    expect(mathHtml('a\\)b', false)).toEqual({ html: 'a<span>\\</span>)b', content: true });
    expect(mathHtml('x\\', false).html).toBe('x<span>\\</span>');
  });

  it('escapes formulas and text as HTML', () => {
    expect(mathHtml('a<b & c>d', false).html).toBe('\\(a&lt;b &amp; c&gt;d\\)');
    expect(bodyOf(convert('<p>5 &lt; 6 &amp; "quoted"</p>').html)).toBe('<p>5 &lt; 6 &amp; &quot;quoted&quot;</p>');
  });

  it('keeps lang and dir, and marks a layout table inside right-to-left text as right to left (Urdu)', () => {
    const result = convert(
      '<div lang="ur" dir="rtl"><p>سوال نمبر ایک</p><div style="display:flex;justify-content:space-between"><span>جواب دیں</span><span>[2]</span></div></div>',
    );
    const body = bodyOf(result.html);
    expect(body.startsWith('<div lang="ur" dir="rtl"><p>سوال نمبر ایک</p><table>')).toBe(true);
    expect(result.tables).toEqual([{ kind: 'layout', indent: 0, rtl: true, ruleAbove: false, ruleBelow: false }]);
  });

  it('keeps an inline language change as a span', () => {
    expect(bodyOf(convert('<p>Word: <span lang="hi">पानी</span></p>').html)).toBe('<p>Word: <span lang="hi">पानी</span></p>');
  });

  it('passes no author attribute, class or style through, and nothing the sanitiser removed', () => {
    const body = bodyOf(convert('<p class="x" style="color:red" onclick="alert(1)">Hi<script>alert(1)</script></p><img src="https://example.com/a.png">').html);
    expect(body).toBe('<p>Hi</p>');
  });
});

describe('Word conversion: figures and diagrams', () => {
  it('names a stored figure as a file of the request, never a URL, and prints a missing one as the PDF does', () => {
    const figures: FigureAssets = new Map([[QPF, { dataUri: PIXEL_PNG }]]);
    const result = convert(`<figure><img data-figure-id="${QPF}"><figcaption>A pixel</figcaption></figure><figure><img data-figure-id="qpf_missing00000000000000"></figure>`, figures);
    expect(result.images).toEqual([{ name: 'qp-image-1.png', type: 'image/png', bytes: dataUriImage(PIXEL_PNG)!.bytes }]);
    const body = bodyOf(result.html);
    expect(body).toContain('<img src="qp-image-1.png" alt="Figure" width="1" height="1">');
    expect(body).toContain('A pixel');
    expect(body).toContain('<em>Figure unavailable</em>');
    expect(body).not.toContain('data:');
  });

  it('serialises an inline SVG on its own, with the styles the cascade gives it and without author classes', () => {
    const result = convert(
      '<style>.d line{stroke:#000;stroke-width:2}</style><div class="d"><svg width="200" height="100" viewBox="0 0 200 100" class="d"><line x1="0" y1="50" x2="200" y2="50"></line><text x="10" y="20">A</text></svg></div>',
    );
    expect(result.svgs).toHaveLength(1);
    const svg = result.svgs[0]!;
    expect(svg).toMatchObject({ name: 'qp-svg-1.png', width: 200, height: 100 });
    expect(svg.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="200" height="100" viewBox="0 0 200 100"/);
    expect(svg.svg).toContain('<line x1="0" y1="50" x2="200" y2="50" style="stroke:#000;stroke-width:2"></line>');
    expect(svg.svg).not.toContain('class=');
    expect(bodyOf(result.html)).toContain('<img src="qp-svg-1.png" alt="Diagram" width="200" height="100">');
  });

  it('reads image sizes from headers and accepts only data URI images whose bytes match their type', () => {
    expect(imageSizeOf(dataUriImage(PIXEL_PNG)!.bytes)).toEqual({ width: 1, height: 1 });
    expect(dataUriImage('https://example.com/a.png')).toBeNull();
    expect(dataUriImage(PIXEL_PNG.replace('image/png', 'image/jpeg'))).toBeNull();
  });
});

describe('Word conversion: the school’s template', () => {
  const context = { ...SAMPLE_QUESTION_PAPER_CONTEXT, school: { ...SAMPLE_QUESTION_PAPER_CONTEXT.school, logoUrl: PIXEL_PNG } };

  it('takes the classic design’s heading before the body and its fixed footer as the Word footer', () => {
    const result = questionPaperDocxHtml({ fragment: '<p>Question one</p>', figures: new Map(), template: renderQuestionPaperTemplate(design('question-paper-classic'), context) });
    const body = bodyOf(result.html);
    expect(body.indexOf(context.school.name)).toBeGreaterThan(-1);
    expect(body.indexOf(context.school.name)).toBeLessThan(body.indexOf('Question one'));
    expect(body).toContain('<img src="qp-image-1.png" alt="Image"');
    expect(body).toContain('Maximum marks: 20');
    expect(body).not.toContain('Half Yearly Examination - Science');
    expect(result.footer).toEqual([{ parts: [context.school.name, 'Half Yearly Examination - Science'], align: 'left', rtl: false, borderTop: true }]);
  });

  it('takes the compact design’s heading table and its footer', () => {
    const result = questionPaperDocxHtml({ fragment: '<p>Question one</p>', figures: new Map(), template: renderQuestionPaperTemplate(design('question-paper-compact'), context) });
    expect(bodyOf(result.html)).toContain('<strong>Examination:</strong>');
    expect(result.tables.map((table) => table.kind).slice(0, 2)).toEqual(['layout', 'data']);
    expect(result.footer).toEqual([{ parts: ['Registration no. SCH-2026', 'Session 2026-2027'], align: 'left', rtl: false, borderTop: true }]);
  });

  it('adds nothing around a standalone paper: the plain shell has no heading and no footer', () => {
    const result = convert('<p>Only the body</p>');
    expect(bodyOf(result.html)).toBe('<p>Only the body</p>');
    expect(result.footer).toEqual([]);
  });
});

describe('Word conversion: the worked examples', () => {
  it.each([
    ['Hindi mathematics', EXAMPLE_HINDI_MATH_HTML],
    ['English science', EXAMPLE_ENGLISH_SCIENCE_HTML],
  ])('converts the %s example: formulas, tables and no authored markup left', (_, fragment) => {
    const result = convert(fragment);
    expect(result.tables.length).toBeGreaterThan(5);
    expect(result.html).not.toMatch(/data-math|data-figure-id|class=|<style|<svg/);
    expect(result.html.match(/\\\(/g)?.length ?? 0).toBeGreaterThan(0);
  });

  it('turns the English example’s diagram into an image and its placeholder into a box', () => {
    const result = convert(EXAMPLE_ENGLISH_SCIENCE_HTML);
    expect(result.svgs).toHaveLength(1);
    expect(result.tables.filter((table) => table.kind === 'box')).toHaveLength(1);
    expect(result.tables.filter((table) => table.kind === 'data')).toHaveLength(1);
  });
});
