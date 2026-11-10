import { describe, expect, it } from 'vitest';

import { NOTICE_AUDIENCE_OPTIONS, noticeAudienceChoicesOffered, noticeAudienceFacts, noticeAudienceLabel, noticeAudienceSelection } from './notice-audience';

describe('notice audience', () => {
  it('stores the two explicit facts for each readable choice', () => {
    expect(noticeAudienceFacts({ audience: 'staff', cadetClassScope: 'all_classes', classIds: [] })).toEqual({ toStaff: true, cadetScope: 'none', classIds: [] });
    expect(noticeAudienceFacts({ audience: 'cadets', cadetClassScope: 'all_classes', classIds: [] })).toEqual({ toStaff: false, cadetScope: 'all_classes', classIds: [] });
    expect(noticeAudienceFacts({ audience: 'staff_and_cadets', cadetClassScope: 'selected_classes', classIds: ['c1'] })).toEqual({ toStaff: true, cadetScope: 'selected_classes', classIds: ['c1'] });
  });

  it('never sends a remembered class selection unless selected classes is the scope', () => {
    expect(noticeAudienceFacts({ audience: 'staff', cadetClassScope: 'selected_classes', classIds: ['c1'] })).toEqual({ toStaff: true, cadetScope: 'none', classIds: [] });
    expect(noticeAudienceFacts({ audience: 'cadets', cadetClassScope: 'all_classes', classIds: ['c1'] }).classIds).toEqual([]);
  });

  it('reads stored facts back as the choice that produced them', () => {
    for (const selection of [
      { audience: 'staff', cadetClassScope: 'all_classes', classIds: [] },
      { audience: 'cadets', cadetClassScope: 'all_classes', classIds: [] },
      { audience: 'cadets', cadetClassScope: 'selected_classes', classIds: ['c1', 'c2'] },
      { audience: 'staff_and_cadets', cadetClassScope: 'selected_classes', classIds: ['c2'] },
    ] as const) {
      expect(noticeAudienceSelection(noticeAudienceFacts(selection))).toEqual(selection);
    }
  });

  it('labels the audience with the recorded class names when they are few', () => {
    expect(noticeAudienceLabel({ toStaff: true, cadetScope: 'none' })).toBe('Staff');
    expect(noticeAudienceLabel({ toStaff: false, cadetScope: 'all_classes' })).toBe('Cadets · All classes');
    expect(noticeAudienceLabel({ toStaff: true, cadetScope: 'selected_classes' }, ['Class 1', 'Class 2'])).toBe('Staff and cadets · Class 1, Class 2');
    // A class deleted since publication is still named: the names are the notice's own record.
    expect(noticeAudienceLabel({ toStaff: false, cadetScope: 'selected_classes' }, ['Class 5', 'Class 8'])).toBe('Cadets · Class 5, Class 8');
    expect(noticeAudienceLabel({ toStaff: false, cadetScope: 'selected_classes' }, ['A', 'B', 'C', 'D'])).toBe('Cadets · 4 classes');
    expect(noticeAudienceLabel({ toStaff: false, cadetScope: 'selected_classes' })).toBe('Cadets · 0 classes');
  });

  it('never promises a delivery channel in the audience descriptions', () => {
    for (const option of Object.values(NOTICE_AUDIENCE_OPTIONS)) expect(option.description).not.toMatch(/whatsapp/i);
  });

  it('offers student audiences only with the Cadet Portal, but always shows the audience a notice already has', () => {
    expect(noticeAudienceChoicesOffered(true, null)).toEqual(['staff', 'cadets', 'staff_and_cadets']);
    expect(noticeAudienceChoicesOffered(true, 'cadets')).toEqual(['staff', 'cadets', 'staff_and_cadets']);
    expect(noticeAudienceChoicesOffered(false, null)).toEqual(['staff']);
    expect(noticeAudienceChoicesOffered(false, 'staff')).toEqual(['staff']);
    // The stored audience is never hidden or replaced.
    expect(noticeAudienceChoicesOffered(false, 'cadets')).toEqual(['staff', 'cadets']);
    expect(noticeAudienceChoicesOffered(false, 'staff_and_cadets')).toEqual(['staff', 'staff_and_cadets']);
  });
});
