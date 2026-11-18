import { describe, expect, it } from 'vitest';

import { applyQuestionPaperEdits } from './question-paper.edits';

const PAPER = `<div class="q"><span class="no">1</span><div class="main">Which gas is released during photosynthesis?
  <div class="opts"><span>(a) Carbon dioxide</span><span>(b) Oxygen</span></div>
</div><span class="marks">[1]</span></div>
<div class="q"><span class="no">2</span><div class="main">Write <span data-math="\\frac{4}{7}"></span> in words.</div><span class="marks">[1]</span></div>`;

describe('find-and-replace edits to a paper', () => {
  it('changes exactly the text it names and leaves every other character as it was', () => {
    const edited = applyQuestionPaperEdits(PAPER, [{ find: '<span>(b) Oxygen</span>', replace: '<span>(b) Ozone</span>' }]);
    expect(edited).toEqual({ ok: true, html: PAPER.replace('(b) Oxygen', '(b) Ozone') });
  });

  it('applies edits in order, each to the result of the ones before it, and deletes with an empty replace', () => {
    const edited = applyQuestionPaperEdits(PAPER, [
      { find: '\\frac{4}{7}', replace: '\\frac{3}{8}' },
      { find: 'Write <span data-math="\\frac{3}{8}"></span>', replace: 'Read <span data-math="\\frac{3}{8}"></span>' },
      { find: '<span class="marks">[1]</span></div>\n<div', replace: '<span class="marks">[2]</span></div>\n<div' },
      { find: ' in words', replace: '' },
    ]);
    expect(edited.ok && edited.html).toBe(
      PAPER.replace('Write', 'Read').replace('\\frac{4}{7}', '\\frac{3}{8}').replace('[1]</span></div>\n<div', '[2]</span></div>\n<div').replace(' in words', ''),
    );
  });

  it('matches a find whose line breaks or indentation differ from the paper, and nothing looser', () => {
    const find = 'photosynthesis? <div class="opts">';
    const edited = applyQuestionPaperEdits(PAPER, [{ find, replace: 'photosynthesis in plants?\n  <div class="opts">' }]);
    expect(edited.ok && edited.html).toBe(PAPER.replace('photosynthesis?', 'photosynthesis in plants?'));
    // Indentation copied in front of text whose tag was left out: the paper's own spacing around the match stays.
    const indented = applyQuestionPaperEdits(PAPER, [{ find: '    (b) Oxygen</span>\n', replace: '    (b) Ozone</span>\n' }]);
    expect(indented.ok && indented.html).toBe(PAPER.replace('(b) Oxygen', '(b) Ozone'));
    // Quotes or letters that differ are not loosened.
    expect(applyQuestionPaperEdits(PAPER, [{ find: "<span class='no'>1</span>", replace: 'x' }]).ok).toBe(false);
  });

  it('refuses a find that is missing or occurs more than once, says which edit, and applies none of them', () => {
    const result = applyQuestionPaperEdits(PAPER, [
      { find: '(a) Carbon dioxide', replace: '(a) Methane' },
      { find: 'Nitrogen', replace: 'Argon' },
      { find: '<span class="marks">[1]</span>', replace: '<span class="marks">[2]</span>' },
    ]);
    expect(result).toEqual({
      ok: false,
      problems: [
        'Edit 2 (find "Nitrogen"): this text is not in the paper. Copy it exactly from the html getQuestionPaper returned for this version, after the edits before it.',
        'Edit 3 (find "<span class=\\"marks\\">[1]</span>"): this text occurs more than once. Include more of the text around it so it occurs once.',
      ],
    });
  });
});
