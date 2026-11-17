import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isQuestionPaperSectionPath, questionPaperClassHref, questionPaperReturnHref } from '@/components/exam/exam-model';
import {
  initialModeFilterRevisions,
  modeFilterRevisionOf,
  modeFilterStorageKey,
  nextModeFilterRevisions,
  parseStoredModeFilter,
  pickerEmptyMessage,
  rankByQuery,
  replaceOpenClass,
  withClassParam,
} from './question-paper-list-model';

const scope = { schoolId: 'sch_1', sessionId: 'ses_1', examSlug: 'first-term' };

test('the sidebar and palette land on the tab with the class open', () => {
  assert.equal(
    questionPaperClassHref({ ...scope, classId: 'cls 8/a' }),
    '/school/sch_1/sessions/ses_1/exam/first-term/question-paper?class=cls%208%2Fa',
  );
});

test("going back from a paper (its breadcrumb, or after deleting it) reopens the paper's class", () => {
  const paper = { ...scope, classId: 'c8', subjectSlug: 'english', modeSlug: 'written' };
  assert.equal(
    questionPaperReturnHref(paper),
    '/school/sch_1/sessions/ses_1/exam/first-term/question-paper?class=c8',
  );
  // Without a class there is nothing to reopen: the bare tab, every class collapsed.
  assert.equal(questionPaperReturnHref(scope), '/school/sch_1/sessions/ses_1/exam/first-term/question-paper');
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

test("another tab's change reseeds only that school's filter; clearing storage reseeds every school", () => {
  const start = initialModeFilterRevisions;
  const otherSchool = nextModeFilterRevisions(start, 'question-paper-mode-filter:sch_2');
  assert.equal(modeFilterRevisionOf(otherSchool, 'sch_1'), 0);
  assert.equal(modeFilterRevisionOf(otherSchool, 'sch_2'), 1);

  const sameSchool = nextModeFilterRevisions(otherSchool, modeFilterStorageKey('sch_1'));
  assert.equal(modeFilterRevisionOf(sameSchool, 'sch_1'), 1);
  assert.equal(modeFilterRevisionOf(sameSchool, 'sch_2'), 1);

  const cleared = nextModeFilterRevisions(sameSchool, null);
  assert.equal(modeFilterRevisionOf(cleared, 'sch_1'), 2);
  assert.equal(modeFilterRevisionOf(cleared, 'sch_2'), 2);
  assert.equal(modeFilterRevisionOf(cleared, 'sch_3'), 1);

  // An unrelated key returns the same revisions, so readers are not told of a change.
  assert.equal(nextModeFilterRevisions(cleared, 'campuspilot:selected-session:sch_1'), cleared);
  assert.equal(start.cleared, 0);
  assert.equal(start.bySchool.size, 0);
});

test('toggling a class replaces the address without scrolling, and collapsing drops the parameter', () => {
  const calls: Array<[string, { scroll: boolean }]> = [];
  const navigation = (search: string) => ({
    pathname: '/school/sch_1/sessions/ses_1/exam/first-term/question-paper',
    search,
    replace: (href: string, options: { scroll: boolean }) => void calls.push([href, options]),
  });
  replaceOpenClass(navigation(''), 'c8');
  replaceOpenClass(navigation('class=c8'), null);
  replaceOpenClass(navigation('class=c8&tab=x'), 'c9');
  assert.deepEqual(calls, [
    ['/school/sch_1/sessions/ses_1/exam/first-term/question-paper?class=c8', { scroll: false }],
    ['/school/sch_1/sessions/ses_1/exam/first-term/question-paper', { scroll: false }],
    ['/school/sch_1/sessions/ses_1/exam/first-term/question-paper?class=c9&tab=x', { scroll: false }],
  ]);
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
