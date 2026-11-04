import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectAllPages,
  commandPaletteContextKey,
  commandFuzzyScore,
  filterManagementCommands,
  hasFinanceActionConfig,
  hasStudentExamResult,
  mapWithConcurrency,
  schoolSessionLabel,
} from './management-command-model';

const commands = [
  ['admission', 'Admission', true, ['students']],
  ['classroom', 'Classroom', true, ['classes']],
  ['examinations', 'Examinations', true, ['results']],
  ['settings', 'Settings', false, ['preferences']],
  ['templates', 'Templates', false, ['report card']],
].map(([id, label, defaultSuggestion, keywords]) => ({
  id: String(id),
  label: String(label),
  description: '',
  defaultSuggestion: Boolean(defaultSuggestion),
  keywords: keywords as string[],
}));

test('empty command search keeps only the three academic defaults', () => {
  assert.deepEqual(
    filterManagementCommands(commands, '').map(({ id }) => id),
    ['admission', 'classroom', 'examinations'],
  );
});

test('search-only settings and templates are found by labels and keywords', () => {
  assert.equal(filterManagementCommands(commands, 'settings')[0]?.id, 'settings');
  assert.equal(filterManagementCommands(commands, 'report card')[0]?.id, 'templates');
});

test('manual fuzzy matching accepts a small typo without matching unrelated text', () => {
  assert.notEqual(commandFuzzyScore('clasroom', ['Classroom']), null);
  assert.equal(commandFuzzyScore('clasroom', ['Admission']), null);
});

test('a student-only query leaves no navigation commands to group', () => {
  assert.deepEqual(filterManagementCommands(commands, 'akib'), []);
});

test('all-page collection preserves page order', async () => {
  const requested: number[] = [];
  const items = await collectAllPages(async (page) => {
    requested.push(page);
    return { items: [`exam-${page}`], pagination: { totalPages: 3 } };
  });
  assert.deepEqual(requested, [1, 2, 3]);
  assert.deepEqual(items, ['exam-1', 'exam-2', 'exam-3']);
});

test('bounded mapping preserves result order and limits active reads', async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return value * 2;
  });
  assert.equal(maximumActive, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test('result eligibility requires assessment or subject result data', () => {
  assert.equal(hasStudentExamResult({ assessment: null, subjects: [] }), false);
  assert.equal(
    hasStudentExamResult({ assessment: { attendance: 10 }, subjects: [] }),
    true,
  );
  assert.equal(
    hasStudentExamResult({
      assessment: null,
      subjects: [{ result: null }, { result: { score: 80 } }],
    }),
    true,
  );
});

test('finance actions require currency and time zone, not billing-cycle readiness', () => {
  assert.equal(hasFinanceActionConfig(undefined), false);
  assert.equal(hasFinanceActionConfig({ currency: 'INR' }), false);
  assert.equal(
    hasFinanceActionConfig({ currency: 'INR', timeZone: 'Asia/Kolkata' }),
    true,
  );
});

test('session label uses the explicit start and end years', () => {
  assert.equal(
    schoolSessionLabel({ sessionStartYear: 2026, sessionEndYear: 2027 }),
    '2026–2027',
  );
});

test('palette context treats school-only and session scopes as distinct', () => {
  assert.equal(commandPaletteContextKey('school-1'), 'school-1:school');
  assert.equal(
    commandPaletteContextKey('school-1', 'session-1'),
    'school-1:session-1',
  );
  assert.notEqual(
    commandPaletteContextKey('school-1', 'session-1'),
    commandPaletteContextKey('school-1', 'session-2'),
  );
});
