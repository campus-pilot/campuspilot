import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CUT_ABOVE, CUT_BELOW, IN_VIEW_END, IN_VIEW_START, screenLines, type ScreenPiece } from './screen-text';

const piece = (top: number, left: number, text: string, inView = true): ScreenPiece => ({ top, left, text, inView });

describe('screenLines', () => {
  it('reads top to bottom, and joins the pieces of one visual row left to right', () => {
    const text = screenLines([piece(300, 400, '2026001'), piece(100, 40, 'Admissions'), piece(302, 40, 'Aanya Menon'), piece(298, 700, 'Class 1'), piece(350, 40, 'Aarohi Pandey')]);
    assert.equal(text, [IN_VIEW_START, 'Admissions', 'Aanya Menon | 2026001 | Class 1', 'Aarohi Pandey', IN_VIEW_END].join('\n'));
  });

  it('reads the whole page at once, and marks the part in the user’s view', () => {
    const text = screenLines([
      piece(0, 0, 'Annual Examination', false),
      piece(100, 0, 'Nursery', false),
      piece(1400, 0, 'UKG'),
      piece(1500, 0, 'Class 1'),
      piece(2600, 0, 'Class 2', false),
    ]);
    assert.equal(text, ['Annual Examination', 'Nursery', IN_VIEW_START, 'UKG', 'Class 1', IN_VIEW_END, 'Class 2'].join('\n'));
  });

  it('tidies each piece and drops empty ones', () => {
    assert.equal(screenLines([piece(0, 0, '  Registration:\n   Registered ', false), piece(40, 0, '   ', false)]), 'Registration: Registered');
  });

  it('keeps the part in view when the page is too long, then what follows it, and says what was left out', () => {
    const pieces = Array.from({ length: 40 }, (_, index) => piece(index * 40, 0, `Row number ${String(index).padStart(2, '0')}`, index >= 20 && index < 22));
    const text = screenLines(pieces, 400);
    const lines = text.split('\n');
    assert.ok(text.length <= 400, `${text.length}`);
    assert.equal(lines[0], CUT_ABOVE);
    assert.equal(lines[1], IN_VIEW_START);
    assert.equal(lines[2], 'Row number 20');
    assert.equal(lines[lines.length - 1], CUT_BELOW);
  });

  it('is empty for an empty page', () => {
    assert.equal(screenLines([]), '');
  });
});
