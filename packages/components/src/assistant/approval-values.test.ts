import { describe, expect, it } from 'vitest';

import { approvalValueDisplay, EMPTY_VALUE, humanizeKey } from './approval-values';

const text = (value: unknown) => approvalValueDisplay(value, 'en-US');

describe('approvalValueDisplay', () => {
  it('shows a dash for a missing or empty value', () => {
    for (const value of [null, undefined, '', [], {}]) {
      expect(text(value)).toEqual({ kind: 'text', text: EMPTY_VALUE });
    }
  });

  it('shows yes and no, not true and false', () => {
    expect(text(true)).toEqual({ kind: 'text', text: 'Yes' });
    expect(text(false)).toEqual({ kind: 'text', text: 'No' });
  });

  it('keeps plain text and numbers as they are', () => {
    expect(text('Grade 3')).toEqual({ kind: 'text', text: 'Grade 3' });
    expect(text(2026)).toEqual({ kind: 'text', text: '2026' });
    expect(text(0)).toEqual({ kind: 'text', text: '0' });
  });

  it('shows a date written as text as a date', () => {
    expect(text('2026-03-12')).toEqual({ kind: 'text', text: 'Mar 12, 2026' });
    // Local time, so the expected text does not depend on where the test runs.
    const local = new Date(2026, 2, 12, 9, 30);
    expect(text(local.toISOString())).toEqual({ kind: 'text', text: 'Mar 12, 2026, 9:30 AM' });
  });

  it('leaves text that only looks like a date alone', () => {
    expect(text('2026-13-45')).toEqual({ kind: 'text', text: '2026-13-45' });
    expect(text('2026-02-31')).toEqual({ kind: 'text', text: '2026-02-31' });
    expect(text('Roll 2026-03')).toEqual({ kind: 'text', text: 'Roll 2026-03' });
  });

  it('joins a list of plain values with commas', () => {
    expect(text(['Maths', 'Science', 3, true])).toEqual({ kind: 'text', text: 'Maths, Science, 3, Yes' });
  });

  it('counts a list of records instead of printing them', () => {
    expect(text([{ name: 'Asha' }])).toEqual({ kind: 'text', text: '1 item' });
    expect(text([{ name: 'Asha' }, { name: 'Ravi' }, 'x'])).toEqual({ kind: 'text', text: '3 items' });
  });

  it('turns a record into labelled rows', () => {
    expect(text({ firstName: 'Asha', is_active: true, dateOfBirth: '2019-06-01' })).toEqual({
      kind: 'fields',
      fields: [
        { key: 'firstName', label: 'First Name', value: { kind: 'text', text: 'Asha' } },
        { key: 'is_active', label: 'Is active', value: { kind: 'text', text: 'Yes' } },
        { key: 'dateOfBirth', label: 'Date Of Birth', value: { kind: 'text', text: 'Jun 1, 2019' } },
      ],
    });
  });

  it('nests records two levels deep and counts anything deeper', () => {
    const display = text({ guardian: { address: { city: 'Pune', pin: '411001' } } });
    expect(display).toEqual({
      kind: 'fields',
      fields: [
        {
          key: 'guardian',
          label: 'Guardian',
          value: {
            kind: 'fields',
            fields: [{ key: 'address', label: 'Address', value: { kind: 'text', text: '2 details' } }],
          },
        },
      ],
    });
  });

  it('never returns JSON syntax for anything JSON can carry', () => {
    const values: unknown[] = [{ a: [1, { b: 2 }] }, [[1, 2]], { a: { b: { c: { d: 1 } } } }];
    const flatten = (display: ReturnType<typeof text>): string[] =>
      display.kind === 'text' ? [display.text] : display.fields.flatMap((field) => flatten(field.value));
    for (const value of values) {
      for (const shown of flatten(text(value))) expect(shown).not.toMatch(/[{}[\]"]/);
    }
  });
});

describe('humanizeKey', () => {
  it('splits camel case, underscores and dashes into words', () => {
    expect(humanizeKey('classTeacherId')).toBe('Class Teacher Id');
    expect(humanizeKey('start_date')).toBe('Start date');
    expect(humanizeKey('roll-number')).toBe('Roll number');
  });
});
