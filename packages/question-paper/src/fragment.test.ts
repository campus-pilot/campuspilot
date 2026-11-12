import { describe, expect, it } from 'vitest';

import { extractQuestionPaperFragment } from './fragment';

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
