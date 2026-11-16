import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classroomHref, classroomSections } from './classroom-sections';

describe('classroomSections', () => {
  it('lists every section, Students first, for a school with student management', () => {
    const sections = classroomSections(true);
    assert.deepEqual(sections.map(({ id }) => id), ['students', 'teachers', 'sections', 'subjects', 'documents', 'settings']);
    assert.deepEqual(sections.filter(({ primary }) => primary).map(({ id }) => id), ['students', 'teachers', 'sections']);
  });

  it('leaves out Students and Documents without student management, so Teachers is the default', () => {
    const sections = classroomSections(false);
    assert.deepEqual(sections.map(({ id }) => id), ['teachers', 'sections', 'subjects', 'settings']);
    assert.deepEqual(sections.filter(({ primary }) => primary).map(({ id }) => id), ['teachers', 'sections']);
    assert.equal(sections[0]?.id, 'teachers');
  });
});

describe('classroomHref', () => {
  it('encodes each part and appends the section', () => {
    const scope = { schoolId: 's 1', sessionId: 'sess', classId: 'c/1' };
    assert.equal(classroomHref(scope), '/school/s%201/sessions/sess/classroom/c%2F1');
    assert.equal(classroomHref(scope, 'teachers'), '/school/s%201/sessions/sess/classroom/c%2F1/teachers');
  });
});
