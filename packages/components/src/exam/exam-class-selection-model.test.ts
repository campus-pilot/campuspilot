import { describe, expect, it } from 'vitest';

import {
  NO_PLAN_SELECTION_CHANGES,
  allSelectableClassIds,
  applyPlanSelectionChanges,
  changesAfterSubjectAdded,
  isClassSelectable,
  offeredSubjects,
  planSelectionChanges,
  sameClassSelection,
  toggleClassSelection,
  toggleSubjectChoice,
} from './exam-class-selection-model';

const subject = { subjectSlug: 'maths', name: 'Maths', issue: null, modes: [] };
const classes = [
  { classId: 'a', label: 'A', studentCount: 1, subjects: [subject] },
  { classId: 'b', label: 'B', studentCount: 1, subjects: [] },
  { classId: 'c', label: 'C', studentCount: 1, subjects: [subject] },
];

describe('exam class selection model', () => {
  it('offers only classes with subjects, unless the class already takes part', () => {
    expect(isClassSelectable(classes[1]!)).toBe(false);
    expect(isClassSelectable(classes[1]!, ['b'])).toBe(true);
    expect(allSelectableClassIds(classes)).toEqual(['a', 'c']);
    expect(allSelectableClassIds(classes, ['b'])).toEqual(['a', 'b', 'c']);
  });

  it('toggles a class keeping the review order', () => {
    expect(toggleClassSelection(classes, ['c'], 'a', true)).toEqual(['a', 'c']);
    expect(toggleClassSelection(classes, ['a', 'c'], 'a', false)).toEqual(['c']);
    expect(toggleClassSelection(classes, ['a'], 'a', true)).toEqual(['a']);
  });

  it('compares selections regardless of order', () => {
    expect(sameClassSelection(['a', 'c'], ['c', 'a'])).toBe(true);
    expect(sameClassSelection(['a'], ['a', 'c'])).toBe(false);
  });
});

describe('exam subject choice', () => {
  const art = { subjectSlug: 'art', name: 'Art', issue: null, modes: [] };
  const reviewed = [
    { classId: 'a', label: 'A', studentCount: 1, subjects: [subject, art] },
    { classId: 'b', label: 'B', studentCount: 1, subjects: [] },
  ];

  it('offers every subject by default and toggles one keeping the review order', () => {
    expect(offeredSubjects(reviewed)).toEqual({ a: ['maths', 'art'], b: [] });
    expect(toggleSubjectChoice(reviewed, { a: ['art'] }, 'a', 'maths', true)).toEqual({ a: ['maths', 'art'] });
    expect(toggleSubjectChoice(reviewed, { a: ['maths', 'art'] }, 'a', 'maths', false)).toEqual({ a: ['art'] });
  });

  it('carries only the changes: kept choices, a new subject checked, a class with its first subject chosen', () => {
    const base = { classIds: [], subjects: offeredSubjects(reviewed) };
    const value = { classIds: ['a'], subjects: { a: ['art'], b: [] } };
    const changes = changesAfterSubjectAdded(reviewed, planSelectionChanges(base, value), 'b', 'gk');
    const fresh = [
      { classId: 'a', label: 'A', studentCount: 1, subjects: [subject, art] },
      { classId: 'b', label: 'B', studentCount: 1, subjects: [{ ...art, subjectSlug: 'gk', name: 'GK' }] },
    ];
    expect(applyPlanSelectionChanges(fresh, { classIds: [], subjects: offeredSubjects(fresh) }, changes)).toEqual({
      classIds: ['a', 'b'],
      subjects: { a: ['art'], b: ['gk'] },
    });
  });

  it('keeps changes someone else saved meanwhile (Edit classes)', () => {
    // The person removes A and unchecks its art; meanwhile someone else adds
    // class C and plans art for B.
    const before = [
      { classId: 'a', label: 'A', studentCount: 1, subjects: [subject, art] },
      { classId: 'b', label: 'B', studentCount: 1, subjects: [subject, art] },
      { classId: 'c', label: 'C', studentCount: 1, subjects: [subject] },
    ];
    const oldBase = { classIds: ['a', 'b'], subjects: { a: ['maths', 'art'], b: ['maths'], c: ['maths'] } };
    const changes = planSelectionChanges(oldBase, { classIds: ['b'], subjects: { a: ['maths'], b: ['maths'], c: ['maths'] } });
    const newBase = { classIds: ['a', 'b', 'c'], subjects: { a: ['maths', 'art'], b: ['maths', 'art'], c: ['maths'] } };
    expect(applyPlanSelectionChanges(before, newBase, changes, newBase.classIds)).toEqual({
      classIds: ['b', 'c'],
      subjects: { a: ['maths'], b: ['maths', 'art'], c: ['maths'] },
    });
  });

  it('drops a class that can no longer take part', () => {
    const changes = { ...NO_PLAN_SELECTION_CHANGES, added: ['a', 'b'] };
    expect(applyPlanSelectionChanges(reviewed, { classIds: [], subjects: {} }, changes).classIds).toEqual(['a']);
  });
});
