import { describe, expect, it } from 'vitest';

import { extractQuestionPaperFragment, hasPaperContent, questionPaperFragmentShapeProblem } from './fragment';

describe('extractQuestionPaperFragment', () => {
  it('returns plain html unchanged apart from trimming', () => {
    expect(extractQuestionPaperFragment('  <p>one</p>\n')).toBe('<p>one</p>');
  });

  it('takes the content of a fenced block and drops the chatter around it', () => {
    const text = 'Here is the paper:\n```html\n<p>one</p>\n```\nHope that helps.';
    expect(extractQuestionPaperFragment(text)).toBe('<p>one</p>');
  });

  it('takes the longest fenced block', () => {
    const text = '```\nshort\n```\ntext\n```html\n<p>the real paper, much longer</p>\n```';
    expect(extractQuestionPaperFragment(text)).toBe('<p>the real paper, much longer</p>');
  });

  it('strips only the opening fence of an unterminated block (an answer cut off)', () => {
    expect(extractQuestionPaperFragment('```html\n<p>cut')).toBe('<p>cut');
  });

  it('drops a leading doctype', () => {
    expect(extractQuestionPaperFragment('<!DOCTYPE html>\n<p>x</p>')).toBe('<p>x</p>');
  });

  it('returns an empty string for an empty answer', () => {
    expect(extractQuestionPaperFragment('  \n ')).toBe('');
    expect(extractQuestionPaperFragment('```html\n```')).toBe('');
  });

  it('keeps backticks that are not a fence', () => {
    expect(extractQuestionPaperFragment('<p>use `x` here</p>')).toBe('<p>use `x` here</p>');
  });
});

describe('questionPaperFragmentShapeProblem (a refusal or chatter is not a paper)', () => {
  it('accepts a fragment that starts and ends with an element', () => {
    expect(questionPaperFragmentShapeProblem('<style>p{color:red}</style><p>one</p>')).toBeNull();
    expect(questionPaperFragmentShapeProblem('  <div>1. Q <span data-math="x"></span></div>\n')).toBeNull();
  });

  it.each([
    "I'm sorry, but I cannot help with that request.",
    'The photographs are too blurry to read.',
    '',
    'a < b and 2 > 1',
  ])('calls %j chatter with no markup', (answer) => {
    expect(questionPaperFragmentShapeProblem(answer)?.kind).toBe('no_markup');
  });

  it.each([
    'Here is the HTML you asked for:\n<p>one</p>',
    '<p>one</p>\nHope this helps!',
    'Q1. text <b>bold</b>',
  ])('calls %j stray text', (answer) => {
    expect(questionPaperFragmentShapeProblem(answer)?.kind).toBe('stray_text');
  });
});

describe('hasPaperContent', () => {
  it('needs a block element and readable text or a formula', () => {
    expect(hasPaperContent('<p>one</p>')).toBe(true);
    expect(hasPaperContent('<div><span data-math="x^2"></span></div>')).toBe(true);
    expect(hasPaperContent('<style>.qp-body p{color:red}</style><p></p>')).toBe(false);
    expect(hasPaperContent('<span>inline only</span>')).toBe(false);
    expect(hasPaperContent('<p></p><div> </div>')).toBe(false);
  });
});
