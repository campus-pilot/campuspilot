import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isQuestionPaperSectionPath, questionPaperClassHref } from '@/components/exam/exam-model';
import {
  modeFilterStorageKey,
  parseStoredModeFilter,
  pickerEmptyMessage,
  rankByQuery,
  withClassParam,
} from './question-paper-list-model';

const scope = { schoolId: 'sch_1', sessionId: 'ses_1', examSlug: 'first-term' };

test('the sidebar and palette land on the tab with the class open', () => {
  assert.equal(
    questionPaperClassHref({ ...scope, classId: 'cls 8/a' }),
    '/school/sch_1/sessions/ses_1/exam/first-term/question-paper?class=cls%208%2Fa',
  );
});

test('the Question paper section is the tab and every paper below it, nothing else of the exam', () => {
  const base = '/school/sch_1/sessions/ses_1';
  assert.equal(isQuestionPaperSectionPath(`${base}/exam/first-term/question-paper`, base), true);
  assert.equal(isQuestionPaperSectionPath(`${base}/exam/first-term/question-paper/c1/english/written`, base), true);
  assert.equal(isQuestionPaperSectionPath(`${base}/exam/first-term/results`, base), false);
  assert.equal(isQuestionPaperSectionPath(`${base}/exam`, base), false);
  assert.equal(isQuestionPaperSectionPath(`${base}/exam/question-paper`, base), false);
  // Another session's papers are not this session's section.
  assert.equal(isQuestionPaperSectionPath('/school/sch_1/sessions/ses_2/exam/first-term/question-paper', base), false);
});

test('opening and collapsing a class rewrites only the class parameter', () => {
  assert.equal(withClassParam('', 'c1'), '?class=c1');
  assert.equal(withClassParam('class=c1', 'c2'), '?class=c2');
  assert.equal(withClassParam('class=c1', null), '');
  assert.equal(withClassParam('foo=1&class=c1', null), '?foo=1');
  assert.equal(withClassParam('foo=1', 'a b'), '?foo=1&class=a+b');
});

test('the mode filter is stored per school as slugs, and a bad entry is no filter', () => {
  assert.equal(modeFilterStorageKey('sch_1'), 'question-paper-mode-filter:sch_1');
  assert.deepEqual(parseStoredModeFilter('["written","oral","written"]'), ['written', 'oral']);
  assert.deepEqual(parseStoredModeFilter(null), []);
  assert.deepEqual(parseStoredModeFilter(''), []);
  assert.deepEqual(parseStoredModeFilter('not json'), []);
  assert.deepEqual(parseStoredModeFilter('{"written":true}'), []);
  assert.deepEqual(parseStoredModeFilter('[1,2]'), []);
  assert.deepEqual(parseStoredModeFilter('[""]'), []);
});

test('the palette picker says whether there is nothing or nothing matches', () => {
  assert.equal(pickerEmptyMessage({ step: 'exam' }, ''), 'No examinations in this session.');
  assert.equal(pickerEmptyMessage({ step: 'exam' }, 'zz'), 'No matching examinations.');
  const classStep = { step: 'class', exam: { slug: 'a', name: 'A' } } as const;
  assert.equal(pickerEmptyMessage(classStep, ' '), 'No classes you can open.');
  assert.equal(pickerEmptyMessage(classStep, 'zz'), 'No matching classes.');
});

test('the picker keeps the given order without a search and ranks matches with one', () => {
  const classes = ['Class 10', 'Class 1', 'Nursery'];
  assert.deepEqual(rankByQuery(classes, '', (name) => [name]), classes);
  assert.deepEqual(rankByQuery(classes, 'nurs', (name) => [name]), ['Nursery']);
  assert.deepEqual(rankByQuery(classes, 'class 1', (name) => [name]), ['Class 1', 'Class 10']);
});
