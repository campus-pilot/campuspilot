import { describe, expect, it } from 'vitest';

import { approvalRecordFields, approvalValueDisplay, EMPTY_VALUE, humanizeKey, isMoneyMapPath } from './approval-values';

const text = (value: unknown) => approvalValueDisplay(value, { locale: 'en-US' });

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

  it('shows every record of a list as its own numbered rows, never a count', () => {
    // Exam marks as the API takes them: what is approved must be visible.
    expect(text({ subjects: [{ subject: 'English', marks: 45 }, { subject: 'Hindi', marks: 38 }] })).toEqual({
      kind: 'fields',
      fields: [
        {
          key: 'subjects',
          label: 'Subjects',
          value: {
            kind: 'fields',
            fields: [
              { key: '0', label: '1', value: { kind: 'fields', fields: [
                { key: 'subject', label: 'Subject', value: { kind: 'text', text: 'English' } },
                { key: 'marks', label: 'Marks', value: { kind: 'text', text: '45' } },
              ] } },
              { key: '1', label: '2', value: { kind: 'fields', fields: [
                { key: 'subject', label: 'Subject', value: { kind: 'text', text: 'Hindi' } },
                { key: 'marks', label: 'Marks', value: { kind: 'text', text: '38' } },
              ] } },
            ],
          },
        },
      ],
    });
  });

  it('numbers the entries of a list that mixes plain values, records and lists', () => {
    expect(text(['A', { slug: 'b' }, [1, 2]])).toEqual({
      kind: 'fields',
      fields: [
        { key: '0', label: '1', value: { kind: 'text', text: 'A' } },
        { key: '1', label: '2', value: { kind: 'fields', fields: [{ key: 'slug', label: 'Slug', value: { kind: 'text', text: 'b' } }] } },
        { key: '2', label: '3', value: { kind: 'text', text: '1, 2' } },
      ],
    });
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

  it('shows a record however deep it is nested', () => {
    expect(text({ guardian: { address: { city: 'Pune' } } })).toEqual({
      kind: 'fields',
      fields: [
        {
          key: 'guardian',
          label: 'Guardian',
          value: {
            kind: 'fields',
            fields: [
              {
                key: 'address',
                label: 'Address',
                value: { kind: 'fields', fields: [{ key: 'city', label: 'City', value: { kind: 'text', text: 'Pune' } }] },
              },
            ],
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

describe('money amounts', () => {
  it('shows a minor-unit amount as money in its sibling currency', () => {
    expect(approvalRecordFields({ amountMinor: '125000', currency: 'INR' })).toEqual([
      { key: 'amountMinor', label: 'Amount', value: { kind: 'text', text: '₹1,250.00' } },
      { key: 'currency', label: 'Currency', value: { kind: 'text', text: 'INR' } },
    ]);
    // The currency's own decimals decide where the point goes.
    expect(approvalRecordFields({ amountMinor: '1250', currency: 'JPY' })[0]?.value).toEqual({ kind: 'text', text: '¥1,250' });
    expect(approvalRecordFields({ amountMinor: '1250', currency: 'KWD' })[0]?.value).toEqual({ kind: 'text', text: 'د.ك1.250' });
  });

  it('uses the explicit currency for amounts that name none, at any depth', () => {
    const lines = { lines: [{ title: 'Tuition', amountMinor: '125000' }] };
    expect(approvalValueDisplay(lines, { currency: 'INR' })).toEqual({
      kind: 'fields',
      fields: [
        {
          key: 'lines',
          label: 'Lines',
          value: {
            kind: 'fields',
            fields: [
              { key: '0', label: '1', value: { kind: 'fields', fields: [
                { key: 'title', label: 'Title', value: { kind: 'text', text: 'Tuition' } },
                { key: 'amountMinor', label: 'Amount', value: { kind: 'text', text: '₹1,250.00' } },
              ] } },
            ],
          },
        },
      ],
    });
  });

  it('never guesses a currency: without one the amount is labelled as minor units', () => {
    expect(approvalRecordFields({ amountMinor: '125000' })).toEqual([
      { key: 'amountMinor', label: 'Amount', value: { kind: 'text', text: '125000 (minor units)' } },
    ]);
    // A currency the platform does not support is not formatted, and the explicit
    // currency does not override the one the record names.
    expect(approvalRecordFields({ amountMinor: '500', currency: 'XYZ' }, { currency: 'INR' })[0]?.value).toEqual({
      kind: 'text',
      text: '500 (minor units)',
    });
    expect(approvalRecordFields({ amountMinor: '500', currency: 'USD' }, { currency: 'INR' })[0]?.value).toEqual({
      kind: 'text',
      text: '$5.00',
    });
  });

  it('leaves a *Minor field that is not an integer amount as an ordinary value', () => {
    expect(approvalRecordFields({ amountMinor: 'twelve', currency: 'INR' })[0]).toEqual({
      key: 'amountMinor',
      label: 'Amount Minor',
      value: { kind: 'text', text: 'twelve' },
    });
  });
});

describe('money maps', () => {
  const run = { runValues: { session: { tuition: '125000' }, classes: { 'grade-1': { transport: '50000' } } } };
  const amounts = (display: ReturnType<typeof approvalValueDisplay>): string[] =>
    display.kind === 'text' ? [display.text] : display.fields.flatMap((field) => amounts(field.value));

  it('matches declared paths, with * for any one key', () => {
    const maps = [['runValues', 'session'], ['runValues', 'classes', '*']] as const;
    expect(isMoneyMapPath(['runValues', 'session'], maps)).toBe(true);
    expect(isMoneyMapPath(['runValues', 'classes', 'grade-1'], maps)).toBe(true);
    expect(isMoneyMapPath(['runValues', 'classes'], maps)).toBe(false);
    expect(isMoneyMapPath(['values'], maps)).toBe(false);
  });

  it('shows every value of a declared fee-slug map as money in the given currency', () => {
    const display = approvalValueDisplay(run, {
      currency: 'INR',
      moneyMaps: [['runValues', 'session'], ['runValues', 'classes', '*']],
    });
    expect(amounts(display)).toEqual(['₹1,250.00', '₹500.00']);
  });

  it('labels declared map values as minor units without a currency, and leaves undeclared maps alone', () => {
    expect(amounts(approvalValueDisplay(run, { moneyMaps: [['runValues', 'session']] }))).toEqual([
      '125000 (minor units)',
      '50000',
    ]);
    // Fee values in configuration are JSON numbers.
    expect(approvalRecordFields({ tuition: 125000 }, { currency: 'INR', moneyMaps: [['values']] }, ['values'])).toEqual([
      { key: 'tuition', label: 'Tuition', value: { kind: 'text', text: '₹1,250.00' } },
    ]);
  });
});

describe('humanizeKey', () => {
  it('splits camel case, underscores and dashes into words', () => {
    expect(humanizeKey('classTeacherId')).toBe('Class Teacher Id');
    expect(humanizeKey('start_date')).toBe('Start date');
    expect(humanizeKey('roll-number')).toBe('Roll number');
  });
});
