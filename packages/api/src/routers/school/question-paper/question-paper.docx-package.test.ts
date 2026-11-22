import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { DocxTable } from './question-paper.docx-html';
import { buildReferenceDocx, DOCX_TEXT_WIDTH_TWIPS, isZipPackage, packageQuestionPaperDocx, rewriteDocxTables, xmlText } from './question-paper.docx-package';

const table = (kind: DocxTable['kind'], extra: Partial<DocxTable> = {}): DocxTable => ({ kind, indent: 0, rtl: false, ruleAbove: false, ruleBelow: false, ...extra });

/** A table as Pandoc writes it: its style, a percentage width, and columns for a 7920-twip text width. */
const pandocTable = (columns: number[], cells: string[] = columns.map(() => '<w:p/>')) =>
  '<w:tbl><w:tblPr><w:tblStyle w:val="Table" /><w:tblW w:type="pct" w:w="5000" /><w:tblLayout w:type="fixed" /><w:tblLook w:val="0000" /></w:tblPr>' +
  `<w:tblGrid>${columns.map((column) => `<w:gridCol w:w="${column}" />`).join('')}</w:tblGrid>` +
  `<w:tr>${cells.map((cell) => `<w:tc><w:tcPr />${cell}</w:tc>`).join('')}</w:tr></w:tbl>`;
const documentXml = (body: string) => `<w:document><w:body>${body}<w:sectPr /></w:body></w:document>`;
const gridOf = (xml: string, index = 0) => [...xml.split('<w:tblGrid>')[index + 1]!.split('</w:tblGrid>')[0]!.matchAll(/w:w="(\d+)"/g)].map((match) => Number(match[1]));

describe('Word package: tables', () => {
  it('gives a layout table no lines and tight margins, and scales its columns to the A4 text width', () => {
    const xml = rewriteDocxTables(documentXml(pandocTable([2376, 5544])), [table('layout')]);
    expect(xml).toContain('<w:top w:val="nil"/>');
    expect(xml).toContain('<w:left w:w="0" w:type="dxa"/>');
    expect(xml).toContain(`<w:tblW w:w="${DOCX_TEXT_WIDTH_TWIPS}" w:type="dxa"/>`);
    expect(gridOf(xml)).toEqual([3061, 7145]);
    expect(gridOf(xml).reduce((sum, column) => sum + column, 0)).toBe(DOCX_TEXT_WIDTH_TWIPS);
  });

  it('gives a box and an authored table thin lines, and an indented table its indent and a narrower width', () => {
    const xml = rewriteDocxTables(documentXml(pandocTable([7920]) + pandocTable([3960, 3960])), [table('box', { indent: 2 }), table('data')]);
    const [box, data] = xml.split('</w:tbl>');
    expect(box).toContain('<w:tblInd w:w="680" w:type="dxa"/>');
    expect(box).toContain('<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>');
    expect(gridOf(xml, 0)).toEqual([DOCX_TEXT_WIDTH_TWIPS - 680]);
    expect(data).toContain('<w:insideV w:val="single"');
  });

  it('writes the table properties in schema order and marks a right-to-left table', () => {
    const xml = rewriteDocxTables(documentXml(pandocTable([7920])), [table('layout', { rtl: true, ruleBelow: true })]);
    const properties = xml.slice(xml.indexOf('<w:tblPr>'), xml.indexOf('</w:tblPr>'));
    const order = ['w:tblStyle', 'w:bidiVisual', 'w:tblW', 'w:tblInd', 'w:tblBorders', 'w:tblLayout', 'w:tblCellMar', 'w:tblLook'].map((name) => properties.indexOf(`<${name}`));
    expect(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]!))).toBe(true);
    expect(properties).toContain('<w:bottom w:val="single"');
    expect(properties).toContain('<w:top w:val="nil"/>');
  });

  it('sizes a nested table to the cell it sits in, after the cell margins of the outer table', () => {
    const inner = pandocTable([3960, 3960]);
    const xml = rewriteDocxTables(documentXml(pandocTable([1980, 5940], ['<w:p/>', inner])), [table('layout'), table('layout')]);
    const outer = gridOf(xml, 0);
    expect(gridOf(xml, 1).reduce((sum, column) => sum + column, 0)).toBe(outer[1]! - 57);
  });

  it('refuses a document whose tables do not match the recorded list', () => {
    expect(() => rewriteDocxTables(documentXml(pandocTable([7920])), [])).toThrow('more tables than were recorded');
    expect(() => rewriteDocxTables(documentXml(''), [table('layout')])).toThrow('0 tables, 1 were recorded');
  });
});

describe('Word package: reference document and package', () => {
  it('builds an A4 reference document with every paragraph style the HTML names', () => {
    const files = unzipSync(buildReferenceDocx([]));
    const styles = strFromU8(files['word/styles.xml']!);
    for (const id of ['QPCenter', 'QPRight', 'QPIndent1', 'QPIndent3', 'QPHeading1', 'QPHeading2Center', 'QPHeading6Right', 'BodyText', 'Compact', 'Table']) {
      expect(styles).toContain(`w:styleId="${id}"`);
    }
    expect(styles).toContain('w:cs="Nirmala UI"');
    expect(strFromU8(files['word/document.xml']!)).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(files['word/footer1.xml']).toBeUndefined();
  });

  it('writes the footer as a real footer part on every page, its text escaped', () => {
    const files = unzipSync(buildReferenceDocx([{ parts: ['A & B <School>', 'Exam'], align: 'left', rtl: false, borderTop: true }]));
    const footer = strFromU8(files['word/footer1.xml']!);
    expect(footer).toContain('A &amp; B &lt;School&gt;');
    expect(footer).toContain(`<w:tab w:val="right" w:pos="${DOCX_TEXT_WIDTH_TWIPS}"/>`);
    expect(footer).toContain('<w:pBdr><w:top w:val="single"');
    expect(strFromU8(files['word/document.xml']!)).toContain('<w:footerReference w:type="default" r:id="rIdQpFooter"/>');
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('/word/footer1.xml');
  });

  it('escapes the XML special characters and drops characters XML cannot hold', () => {
    expect(xmlText('a<b>&"c\'\u0001\u0008d￿')).toBe('a&lt;b&gt;&amp;&quot;c&apos;d');
  });

  it('rewrites only the document part of a package and refuses anything that is not a zip', () => {
    const docx = zipSync({ 'word/document.xml': strToU8(documentXml(pandocTable([7920]))), 'word/styles.xml': strToU8('<w:styles/>') });
    const files = unzipSync(packageQuestionPaperDocx(docx, [table('box')]));
    expect(strFromU8(files['word/document.xml']!)).toContain('<w:tblBorders><w:top w:val="single"');
    expect(strFromU8(files['word/styles.xml']!)).toBe('<w:styles/>');
    expect(isZipPackage(strToU8('not a zip'))).toBe(false);
    expect(() => packageQuestionPaperDocx(strToU8('not a zip'), [])).toThrow('not a .docx package');
  });
});
