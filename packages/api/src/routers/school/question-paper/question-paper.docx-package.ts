import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

import { DOCX_PARAGRAPH_STYLES, type DocxFooterLine, type DocxTable } from './question-paper.docx-html';

/**
 * The Word package around Pandoc's output (docs/question-papers.md "Word
 * download"). Pure, and written as text here rather than kept as a binary
 * template: every byte of the reference document is reviewable in this file.
 *
 * 1. {@link buildReferenceDocx}: the reference document Pandoc styles its
 *    output with (`reference-doc`). A4 with 15 mm margins, Arial with Nirmala
 *    UI (Windows' font for Indian scripts) for complex scripts, tight spacing,
 *    every paragraph style the HTML names ({@link DOCX_PARAGRAPH_STYLES}) and
 *    the built-in ones Pandoc writes. Pandoc keeps its section (page size,
 *    margins) and its footer part, so the paper's footer is written here as a
 *    real Word footer that repeats on every page, like the PDF's fixed footer.
 * 2. {@link packageQuestionPaperDocx}: Pandoc writes every table alike, with
 *    column widths for a 7920-twip text width. Each table is given what its
 *    kind needs (`DocxTable`, recorded by the HTML step in the same order):
 *    no lines and tight cell margins for a layout table, thin lines for a box
 *    or an authored table, the indent of the text around it, right to left
 *    when it is, and column widths scaled to the space it really has (the
 *    page's text width, or the cell a nested table sits in).
 *
 * Every string written into XML goes through {@link xmlText}. The package
 * read back from Pandoc is bounded before it is inflated.
 */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** A4 in twips, 15 mm margins, and the text width between them (180 mm). */
const PAGE = { width: 11906, height: 16838, margin: 850, headerFooter: 425 } as const;
export const DOCX_TEXT_WIDTH_TWIPS = PAGE.width - 2 * PAGE.margin;
/** One indent level of the `QP Indent` styles and of an indented table, in twips (6 mm). */
const INDENT_STEP_TWIPS = 340;
/** Bounds on the package read back from the converter. */
const MAX_PART_BYTES = 64_000_000;
const MAX_PACKAGE_BYTES = 128_000_000;

/** Text and attribute values as XML: the five special characters escaped, characters XML 1.0 cannot carry removed. */
export function xmlText(value: string): string {
  return value
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const paragraphStyle = (id: string, name: string, pPr: string, rPr = '', basedOn = 'BodyText', extra = '') =>
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${xmlText(name)}"/><w:basedOn w:val="${basedOn}"/>${extra}<w:qFormat/>` +
  `${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:style>`;

/** Half-points per heading level (14, 12, then 11 pt), as the PDF's default body sheet sizes them. */
const HEADING_SIZES = [28, 24, 22, 22, 22, 22];

/** `styles.xml` of the reference document. Style ids are the names without spaces, which is how Pandoc names a custom style. */
function stylesXml(): string {
  const custom: string[] = [
    paragraphStyle('QPCenter', DOCX_PARAGRAPH_STYLES.center, '<w:jc w:val="center"/>'),
    paragraphStyle('QPRight', DOCX_PARAGRAPH_STYLES.right, '<w:jc w:val="right"/>'),
    ...([1, 2, 3] as const).map((level) => paragraphStyle(`QPIndent${level}`, DOCX_PARAGRAPH_STYLES.indent(level), `<w:ind w:left="${level * INDENT_STEP_TWIPS}"/>`)),
  ];
  for (let level = 1; level <= 6; level += 1) {
    const size = HEADING_SIZES[level - 1]!;
    for (const align of [null, 'center', 'right'] as const) {
      const name = DOCX_PARAGRAPH_STYLES.heading(level, align);
      custom.push(
        paragraphStyle(
          name.replace(/ /g, ''),
          name,
          `<w:keepNext/><w:spacing w:before="120" w:after="60"/>${align ? `<w:jc w:val="${align}"/>` : ''}`,
          `<w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
          'BodyText',
          '<w:next w:val="BodyText"/>',
        ),
      );
    }
  }
  return (
    `${XML_HEADER}<w:styles xmlns:w="${W_NS}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Nirmala UI"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="20" w:after="60"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="FirstParagraph"><w:name w:val="First Paragraph"/><w:basedOn w:val="BodyText"/><w:next w:val="BodyText"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Compact"><w:name w:val="Compact"/><w:basedOn w:val="BodyText"/><w:qFormat/><w:pPr><w:spacing w:before="10" w:after="30"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="BlockText"><w:name w:val="Block Text"/><w:basedOn w:val="BodyText"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:ind w:left="340"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Figure"><w:name w:val="Figure"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="CaptionedFigure"><w:name w:val="Captioned Figure"/><w:basedOn w:val="Figure"/><w:pPr><w:keepNext/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="ImageCaption"><w:name w:val="Image Caption"/><w:basedOn w:val="BodyText"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableCaption"><w:name w:val="Table Caption"/><w:basedOn w:val="BodyText"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style>' +
    custom.join('') +
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
    '<w:style w:type="character" w:customStyle="1" w:styleId="BodyTextChar"><w:name w:val="Body Text Char"/><w:basedOn w:val="DefaultParagraphFont"/></w:style>' +
    '<w:style w:type="character" w:customStyle="1" w:styleId="VerbatimChar"><w:name w:val="Verbatim Char"/><w:basedOn w:val="BodyTextChar"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="BodyTextChar"/></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
    '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="Table"><w:name w:val="Table"/><w:basedOn w:val="TableNormal"/><w:tblPr/></w:style>' +
    '</w:styles>'
  );
}

/** The footer part: one paragraph per line, the parts placed with a centre and a right tab stop. */
function footerXml(lines: readonly DocxFooterLine[]): string {
  const run = (text: string, rtl: boolean) =>
    `<w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/>${rtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;
  const tab = '<w:r><w:tab/></w:r>';
  const paragraphs = lines.map((line) => {
    const parts = line.parts;
    const tabs =
      parts.length === 1
        ? ''
        : `<w:tabs>${parts.length === 3 ? `<w:tab w:val="center" w:pos="${Math.round(DOCX_TEXT_WIDTH_TWIPS / 2)}"/>` : ''}<w:tab w:val="right" w:pos="${DOCX_TEXT_WIDTH_TWIPS}"/></w:tabs>`;
    const border = line.borderTop ? '<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="000000"/></w:pBdr>' : '';
    const align = parts.length === 1 && line.align !== 'left' ? `<w:jc w:val="${line.align}"/>` : '';
    const runs = parts.map((part) => run(part, line.rtl)).join(tab);
    return `<w:p><w:pPr>${border}${tabs}${line.rtl ? '<w:bidi/>' : ''}<w:spacing w:before="0" w:after="0"/>${align}</w:pPr>${runs}</w:p>`;
  });
  return `${XML_HEADER}<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${paragraphs.join('')}</w:ftr>`;
}

/**
 * The reference document for one conversion: styles, the A4 section and, when
 * the template has a fixed footer, the footer part the section shows on every
 * page.
 */
export function buildReferenceDocx(footer: readonly DocxFooterLine[]): Uint8Array {
  const hasFooter = footer.length > 0;
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        (hasFooter ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/_rels/document.xml.rels': strToU8(
      `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        (hasFooter ? '<Relationship Id="rIdQpFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : '') +
        '</Relationships>',
    ),
    'word/document.xml': strToU8(
      `${XML_HEADER}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body><w:sectPr>` +
        (hasFooter ? '<w:footerReference w:type="default" r:id="rIdQpFooter"/>' : '') +
        `<w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/>` +
        `<w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="${PAGE.headerFooter}" w:footer="${PAGE.headerFooter}" w:gutter="0"/>` +
        '</w:sectPr></w:body></w:document>',
    ),
    'word/styles.xml': strToU8(stylesXml()),
    ...(hasFooter ? { 'word/footer1.xml': strToU8(footerXml(footer)) } : {}),
  };
  return zipSync(files);
}

const BORDER_SIDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const;
const LINE = 'w:val="single" w:sz="4" w:space="0" w:color="000000"';
const LINES = `<w:tblBorders>${BORDER_SIDES.map((side) => `<w:${side} ${LINE}/>`).join('')}</w:tblBorders>`;
/** A layout table draws no lines, except a rule along its top or bottom edge when its row drew one. */
const layoutBorders = (table: DocxTable) =>
  `<w:tblBorders>${BORDER_SIDES.map((side) => `<w:${side} ${(side === 'top' && table.ruleAbove) || (side === 'bottom' && table.ruleBelow) ? LINE : 'w:val="nil"'}/>`).join('')}</w:tblBorders>`;
/** Cell margins in twips: a layout table's text sits on its column's edge (a little room on the right), a lined one's away from the lines. */
const CELL_MARGINS = { layout: { top: 0, left: 0, bottom: 0, right: 57 }, lined: { top: 40, left: 100, bottom: 40, right: 100 } } as const;
const cellMarginsOf = (table: DocxTable) => (table.kind === 'layout' ? CELL_MARGINS.layout : CELL_MARGINS.lined);

function tablePropertiesXml(table: DocxTable, widthTwips: number, indentTwips: number, autofit: boolean): string {
  const margins = cellMarginsOf(table);
  return (
    '<w:tblPr><w:tblStyle w:val="Table"/>' +
    (table.rtl ? '<w:bidiVisual/>' : '') +
    (autofit ? '<w:tblW w:w="0" w:type="auto"/>' : `<w:tblW w:w="${widthTwips}" w:type="dxa"/>`) +
    `<w:tblInd w:w="${indentTwips}" w:type="dxa"/>` +
    (table.kind === 'layout' ? layoutBorders(table) : LINES) +
    (autofit ? '' : '<w:tblLayout w:type="fixed"/>') +
    `<w:tblCellMar><w:top w:w="${margins.top}" w:type="dxa"/><w:left w:w="${margins.left}" w:type="dxa"/><w:bottom w:w="${margins.bottom}" w:type="dxa"/><w:right w:w="${margins.right}" w:type="dxa"/></w:tblCellMar>` +
    '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>'
  );
}

/** Column widths scaled to `width` twips, kept in proportion and summing exactly to it. */
function scaledGrid(columns: readonly number[], width: number): number[] {
  const total = columns.reduce((sum, column) => sum + column, 0);
  if (columns.length === 0) return [];
  const raw = total > 0 ? columns.map((column) => (column * width) / total) : columns.map(() => width / columns.length);
  const rounded = raw.map((column) => Math.max(1, Math.floor(column)));
  rounded[rounded.length - 1]! += width - rounded.reduce((sum, column) => sum + column, 0);
  return rounded;
}

/** The text width Pandoc sizes every table for, in twips (it does not read the reference document's page). */
const PANDOC_TEXT_WIDTH_TWIPS = 7920;

/** The element whose start tag ends at `end`: its content and the index after it (a self-closing tag has none). */
function elementAt(xml: string, end: number, name: string): { inner: string; after: number } {
  if (xml[end - 1] === '/') return { inner: '', after: end + 1 };
  const closing = `</${name}>`;
  const finish = xml.indexOf(closing, end);
  if (finish < 0) throw new Error(`The converted document has an unclosed <${name}>.`);
  return { inner: xml.slice(end + 1, finish), after: finish + closing.length };
}

/** How many grid columns the first row after `from` spans (its cells and their `gridSpan`), at least one. Nested tables are skipped. */
function firstRowColumns(xml: string, from: number): number {
  let depth = 0;
  let columns = 0;
  for (let at = xml.indexOf('<', from); at >= 0; at = xml.indexOf('<', at + 1)) {
    if (xml.startsWith('<w:tbl>', at) || xml.startsWith('<w:tbl ', at)) depth += 1;
    else if (xml.startsWith('</w:tbl>', at)) {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth > 0) continue;
    else if (xml.startsWith('<w:tc>', at) || xml.startsWith('<w:tc ', at)) columns += 1;
    else if (xml.startsWith('<w:gridSpan', at)) columns += Math.max(1, Number(/^<w:gridSpan w:val="(\d{1,3})"/.exec(xml.slice(at, at + 40))?.[1] ?? 1)) - 1;
    else if (xml.startsWith('</w:tr>', at)) break;
  }
  return Math.max(1, columns);
}

type Frame = { table: DocxTable; width: number; grid: number[]; column: number; cell: { start: number; span: number } | null };

/**
 * Gives every table of `document.xml` the properties its kind needs (see the
 * file note). One forward scan over the tags; nested tables take the width of
 * the cell they sit in. The tables found must be exactly the ones recorded,
 * else the conversion is refused (the two lists drifted apart: a bug, never a
 * paper to guess about).
 */
export function rewriteDocxTables(documentXml: string, tables: readonly DocxTable[]): string {
  const out: string[] = [];
  const stack: Frame[] = [];
  let seen = 0;
  let at = 0;
  let copied = 0;
  const copyTo = (index: number) => {
    out.push(documentXml.slice(copied, index));
    copied = index;
  };
  while (true) {
    // One '<' at a time (text never holds one), so the scan is linear in the document.
    const start = documentXml.indexOf('<', at);
    if (start < 0) break;
    const end = documentXml.indexOf('>', start);
    if (end < 0) break;
    at = end + 1;
    const isClose = documentXml[start + 1] === '/';
    if (!documentXml.startsWith('w:', start + (isClose ? 2 : 1))) continue;
    const nameEnd = (() => {
      let index = start + (isClose ? 2 : 1);
      while (index < end && !' \t\n\r/>'.includes(documentXml[index]!)) index += 1;
      return index;
    })();
    const name = documentXml.slice(start + (isClose ? 2 : 1), nameEnd);
    const top = stack.at(-1);
    if (!isClose && name === 'w:tbl') {
      const table = tables[seen];
      if (!table) throw new Error('The converted document has more tables than were recorded.');
      seen += 1;
      let width: number;
      if (top?.cell) {
        const margins = cellMarginsOf(top.table);
        width = top.grid.slice(top.cell.start, top.cell.start + top.cell.span).reduce((sum, column) => sum + column, 0) - margins.left - margins.right;
      } else width = DOCX_TEXT_WIDTH_TWIPS - Math.min(3, table.indent) * INDENT_STEP_TWIPS;
      stack.push({ table, width: Math.max(300, Math.round(width)), grid: [], column: 0, cell: null });
    } else if (isClose && name === 'w:tbl') {
      stack.pop();
    } else if (!isClose && top && name === 'w:tblPr') {
      // The table's properties and the grid Pandoc writes right after them are replaced together: the grid decides how
      // wide the table is, which its properties state.
      const properties = elementAt(documentXml, end, name);
      const gridStart = documentXml.indexOf('<', properties.after);
      const gridEnd = documentXml.indexOf('>', gridStart);
      if (gridStart < 0 || gridEnd < 0 || documentXml.slice(properties.after, gridStart).trim() !== '' || !documentXml.startsWith('<w:tblGrid', gridStart)) {
        throw new Error('The converted document has a table without a column grid after its properties.');
      }
      const grid = elementAt(documentXml, gridEnd, 'w:tblGrid');
      let columns = [...grid.inner.matchAll(/<w:gridCol w:w="(\d{1,7})"/g)].map((match) => Number(match[1]));
      // A grid without columns: as many equal columns as the first row has cells.
      if (columns.length === 0) columns = Array<number>(firstRowColumns(documentXml, grid.after)).fill(PANDOC_TEXT_WIDTH_TWIPS);
      const total = columns.reduce((sum, column) => sum + column, 0);
      // Pandoc sizes a table that is narrower than its space (a flex row whose items do not fill it) as that share of 7920 twips.
      const share = total > 0 ? Math.min(1, total / PANDOC_TEXT_WIDTH_TWIPS) : 1;
      const width = Math.max(300, Math.round(top.width * share));
      top.grid = scaledGrid(columns, width);
      copyTo(start);
      // Pandoc writes an autofit table (no fixed layout) when the HTML gave no column widths; it stays one.
      const autofit = !properties.inner.includes('w:tblLayout');
      const indent = stack.length > 1 ? 0 : Math.min(3, top.table.indent) * INDENT_STEP_TWIPS;
      out.push(tablePropertiesXml(top.table, width, indent, autofit));
      out.push(`<w:tblGrid>${top.grid.map((column) => `<w:gridCol w:w="${column}"/>`).join('')}</w:tblGrid>`);
      copied = grid.after;
      at = copied;
    } else if (top && !isClose && name === 'w:tr') {
      top.column = 0;
    } else if (top && !isClose && name === 'w:tc') {
      top.cell = { start: top.column, span: 1 };
    } else if (top?.cell && !isClose && name === 'w:gridSpan') {
      const span = Number(/w:val="(\d{1,3})"/.exec(documentXml.slice(start, end))?.[1] ?? 1);
      top.cell.span = Math.max(1, span);
    } else if (top?.cell && isClose && name === 'w:tc') {
      top.column += top.cell.span;
      top.cell = null;
    }
  }
  if (seen !== tables.length) throw new Error(`The converted document has ${seen} tables, ${tables.length} were recorded.`);
  copyTo(documentXml.length);
  return out.join('');
}

/** A .docx package: the zip signature of its first local file header. */
export const isZipPackage = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/**
 * The finished Word file from Pandoc's output: the tables rewritten
 * ({@link rewriteDocxTables}), every other part unchanged. Parts are bounded
 * before they are inflated.
 */
export function packageQuestionPaperDocx(docx: Uint8Array, tables: readonly DocxTable[]): Uint8Array {
  if (!isZipPackage(docx)) throw new Error('The Word converter returned something that is not a .docx package.');
  let total = 0;
  const files = unzipSync(docx, {
    filter: (file) => {
      total += file.originalSize;
      if (file.originalSize > MAX_PART_BYTES || total > MAX_PACKAGE_BYTES) throw new Error('The Word converter returned an oversized package.');
      return true;
    },
  });
  const document = files['word/document.xml'];
  if (!document) throw new Error('The Word converter returned a package without word/document.xml.');
  files['word/document.xml'] = strToU8(rewriteDocxTables(strFromU8(document), tables));
  return zipSync(files);
}
