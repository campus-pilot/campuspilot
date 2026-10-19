import { describe, expect, it } from 'vitest';

import { documentGrade, documentScheduleSlot } from './document.context';

describe('document context helpers', () => {
  it('selects the highest qualifying grade regardless of insertion order', () => {
    const scale = {
      pass: { label: 'Pass', minScore: 40 },
      distinction: { label: 'Distinction', minScore: 75 },
      merit: { label: 'Merit', minScore: 60 },
    };

    expect(documentGrade(82, scale)).toBe('Distinction');
    expect(documentGrade(65, scale)).toBe('Merit');
    expect(documentGrade(40, scale)).toBe('Pass');
  });

  it('returns an explicit placeholder below every configured threshold', () => {
    expect(
      documentGrade(39.9, {
        pass: { label: 'Pass', minScore: 40 },
      }),
    ).toBe('—');
    expect(documentGrade(100, {})).toBe('—');
  });

  it('formats calendar dates in UTC without shifting the source date', () => {
    expect(
      documentScheduleSlot({
        date: '2026-01-15',
        startTime: '09:05',
        endTime: '10:30',
      }),
    ).toEqual({
      date: '2026-01-15',
      displayDate: '15 Jan 2026',
      dayOfWeek: 'Thursday',
      startTime: '09:05',
      endTime: '10:30',
      displayStartTime: '9:05 AM',
      displayEndTime: '10:30 AM',
    });
  });

  it.each([
    ['00:00', '12:00 AM'],
    ['12:00', '12:00 PM'],
    ['13:07', '1:07 PM'],
    ['23:59', '11:59 PM'],
  ])('formats school-local time %s as %s', (time, displayTime) => {
    const slot = documentScheduleSlot({
      date: '2026-01-15',
      startTime: time,
      endTime: time,
    });

    expect(slot.displayStartTime).toBe(displayTime);
    expect(slot.displayEndTime).toBe(displayTime);
  });
});
