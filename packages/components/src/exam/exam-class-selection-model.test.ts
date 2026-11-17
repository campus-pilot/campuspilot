import { describe, expect, it } from 'vitest';

import {
  allSelectableClassIds,
  isClassSelectable,
  sameClassSelection,
  toggleClassSelection,
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
