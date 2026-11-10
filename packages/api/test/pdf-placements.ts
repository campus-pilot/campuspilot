import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, type PDFDocument, type PDFStream } from 'pdf-lib';

/**
 * Where a page draws an embedded page (a form XObject), read back from the
 * page's content stream: the object it draws, the scale and offset of the
 * transformation in effect at its `Do`, and the object's bounding box.
 */
export type PdfPagePlacement = {
  /** The XObject's indirect reference, as `"12 0 R"`: two placements of the same page share it. */
  object: string;
  scaleX: number;
  scaleY: number;
  /** Lower-left corner of the placed object in the page's points. */
  x: number;
  y: number;
  /** The XObject's `/BBox` (in its own units): the part of the source page that is drawn. */
  bbox: number[];
};

/** Everything a page's content stream says about how it draws, for tests of imposition. */
export type PdfPageDrawing = {
  placements: PdfPagePlacement[];
  /** Whether the stream sets a clipping path (`W` / `W*`), which could crop a placement. */
  clips: boolean;
};

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `next cm` applied after `current`: PDF concatenates `next × current`. */
function concat(next: Matrix, current: Matrix): Matrix {
  const [a, b, c, d, e, f] = next;
  const [A, B, C, D, E, F] = current;
  return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
}

function streamText(stream: PDFStream): string {
  const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return Buffer.from(bytes).toString('latin1');
}

/**
 * Reads the placements of embedded pages on one page by interpreting the
 * operators that matter (`q`, `Q`, `cm`, `Do`, `W`, `W*`) of its content
 * streams. Enough for pages pdf-lib draws; not a general PDF interpreter.
 */
export function readPdfPageDrawing(document: PDFDocument, pageIndex: number): PdfPageDrawing {
  const node = document.getPage(pageIndex).node;
  const contents = node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => document.context.lookup(ref) as PDFStream) : contents ? [contents] : [];
  const xObjects = node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  const tokens = streams.map(streamText).join('\n').split(/\s+/).filter(Boolean);

  const placements: PdfPagePlacement[] = [];
  const saved: Matrix[] = [];
  let matrix = IDENTITY;
  let clips = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const operator = tokens[index];
    if (operator === 'q') saved.push(matrix);
    else if (operator === 'Q') matrix = saved.pop() ?? IDENTITY;
    else if (operator === 'W' || operator === 'W*') clips = true;
    else if (operator === 'cm') matrix = concat(tokens.slice(index - 6, index).map(Number) as Matrix, matrix);
    else if (operator === 'Do') {
      const name = tokens[index - 1]!.replace(/^\//, '');
      const ref = xObjects?.get(PDFName.of(name));
      if (!(ref instanceof PDFRef)) throw new Error(`XObject ${name} is not an indirect reference`);
      const object = document.context.lookup(ref) as PDFStream;
      const bbox = object.dict.lookup(PDFName.of('BBox'), PDFArray).asArray().map((value) => Number(value.toString()));
      placements.push({ object: ref.toString(), scaleX: matrix[0], scaleY: matrix[3], x: matrix[4], y: matrix[5], bbox });
    }
  }
  return { placements, clips };
}
