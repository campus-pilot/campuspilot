import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultExamSection, examSectionOf, isQuestionPaperWorkspacePath, questionPaperWorkspaceHref } from './exam-model';

test('Question paper is the default only for a ready exam with a plan and an allowed assistant', () => {
  assert.equal(defaultExamSection({ planCount: 3, status: 'ready', assistant: 'allowed', studentManagement: 'allowed' }), 'question-paper');
  assert.equal(defaultExamSection({ planCount: 3, status: 'ready', assistant: 'denied', studentManagement: 'allowed' }), 'results');
  assert.equal(defaultExamSection({ planCount: 3, status: 'active', assistant: 'allowed', studentManagement: 'allowed' }), 'results');
  assert.equal(defaultExamSection({ planCount: 3, status: 'completed', assistant: 'allowed', studentManagement: 'allowed' }), 'results');
  // No plan: Results holds plan creation.
  assert.equal(defaultExamSection({ planCount: 0, status: 'ready', assistant: 'allowed', studentManagement: 'allowed' }), 'results');
  assert.equal(defaultExamSection({ planCount: 0, status: null, assistant: 'allowed', studentManagement: 'allowed' }), 'results');
  // A plan alone is not a lifecycle state.
  assert.equal(defaultExamSection({ planCount: 3, status: null, assistant: 'allowed', studentManagement: 'allowed' }), 'results');
});

test('the landing waits for the assistant answer only when it matters', () => {
  assert.equal(defaultExamSection({ planCount: 3, status: 'ready', assistant: 'pending', studentManagement: 'allowed' }), 'pending');
  // Whatever the assistant says, these never become Question paper, so no waiting.
  assert.equal(defaultExamSection({ planCount: 3, status: 'active', assistant: 'pending', studentManagement: 'allowed' }), 'results');
  assert.equal(defaultExamSection({ planCount: 0, status: 'ready', assistant: 'pending', studentManagement: 'allowed' }), 'results');
});

test('without student management an exam with plans lands on Question paper or More, never Results', () => {
  const off = { studentManagement: 'denied' } as const;
  assert.equal(defaultExamSection({ planCount: 3, status: 'ready', assistant: 'allowed', ...off }), 'question-paper');
  // Results do not exist, so a started or completed exam still opens its papers.
  assert.equal(defaultExamSection({ planCount: 3, status: 'active', assistant: 'allowed', ...off }), 'question-paper');
  assert.equal(defaultExamSection({ planCount: 3, status: 'completed', assistant: 'allowed', ...off }), 'question-paper');
  assert.equal(defaultExamSection({ planCount: 3, status: 'ready', assistant: 'denied', ...off }), 'settings');
  assert.equal(defaultExamSection({ planCount: 3, status: 'ready', assistant: 'pending', ...off }), 'pending');
  // No plan: plan creation is the only thing to do, with or without the feature.
  assert.equal(defaultExamSection({ planCount: 0, status: 'ready', assistant: 'allowed', ...off }), 'results');
});

test('the landing waits for the student management answer once there is a plan', () => {
  assert.equal(defaultExamSection({ planCount: 3, status: 'ready', assistant: 'allowed', studentManagement: 'pending' }), 'pending');
  assert.equal(defaultExamSection({ planCount: 0, status: 'ready', assistant: 'allowed', studentManagement: 'pending' }), 'results');
});

test('pathnames map to workspace tabs', () => {
  const base = '/school/s/sessions/x/exam/half-yearly';
  assert.equal(examSectionOf(base, base), 'results');
  assert.equal(examSectionOf(`${base}/`, base), 'results');
  assert.equal(examSectionOf(`${base}/results`, base), 'results');
  assert.equal(examSectionOf(`${base}/classes/c1`, base), 'results');
  assert.equal(examSectionOf(`${base}/question-paper`, base), 'question-paper');
  assert.equal(examSectionOf(`${base}/question-paper/c1/sci/theory`, base), 'question-paper');
  assert.equal(examSectionOf(`${base}/timetable`, base), 'timetable');
  assert.equal(examSectionOf(`${base}/settings`, base), 'settings');
  // A class whose id starts like the section is still Results.
  assert.equal(examSectionOf(`${base}/classes/question-paper`, base), 'results');
});

test('only one paper\'s screen takes the window from the exam\'s heading and tabs', () => {
  const base = '/school/s/sessions/x/exam/half-yearly';
  assert.equal(isQuestionPaperWorkspacePath(`${base}/question-paper/c1/sci/theory`, base), true);
  assert.equal(isQuestionPaperWorkspacePath(`${base}/question-paper/c1/sci/theory/`, base), true);
  // The grid of papers, and every other section, keep the exam's heading and tabs.
  assert.equal(isQuestionPaperWorkspacePath(`${base}/question-paper`, base), false);
  assert.equal(isQuestionPaperWorkspacePath(`${base}/question-paper/c1/sci`, base), false);
  assert.equal(isQuestionPaperWorkspacePath(`${base}/results`, base), false);
  assert.equal(isQuestionPaperWorkspacePath(`${base}/classes/question-paper/a/b/c`, base), false);
});

test('paper links encode every segment and keep what the screen shows in the query', () => {
  const scope = { schoolId: 's', sessionId: 'x', examSlug: 'half yearly', classId: 'c/1', subjectSlug: 'sci', modeSlug: 'theory' };
  assert.equal(
    questionPaperWorkspaceHref(scope),
    '/school/s/sessions/x/exam/half%20yearly/question-paper/c%2F1/sci/theory',
  );
  assert.equal(
    questionPaperWorkspaceHref(scope, { version: 2, chat: 'asc_1' }),
    '/school/s/sessions/x/exam/half%20yearly/question-paper/c%2F1/sci/theory?version=2&chat=asc_1',
  );
  assert.equal(
    questionPaperWorkspaceHref(scope, { start: 'sources' }),
    '/school/s/sessions/x/exam/half%20yearly/question-paper/c%2F1/sci/theory?start=sources',
  );
  // Comparing with the photos is in the address only while it is on.
  assert.equal(
    questionPaperWorkspaceHref(scope, { version: 2, compare: true }),
    '/school/s/sessions/x/exam/half%20yearly/question-paper/c%2F1/sci/theory?version=2&compare=1',
  );
  assert.equal(
    questionPaperWorkspaceHref(scope, { compare: false }),
    '/school/s/sessions/x/exam/half%20yearly/question-paper/c%2F1/sci/theory',
  );
});
