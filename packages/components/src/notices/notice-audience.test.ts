import { describe, expect, it } from 'vitest';

import { noticeAudienceFacts, noticeAudienceLabel, noticeAudienceSelection } from './notice-audience';

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

  it('labels the audience with the classes when they are few and known', () => {
    const labels = new Map([['c1', 'Class 1'], ['c2', 'Class 2']]);
    expect(noticeAudienceLabel({ toStaff: true, cadetScope: 'none', classIds: [] })).toBe('Staff');
    expect(noticeAudienceLabel({ toStaff: false, cadetScope: 'all_classes', classIds: [] })).toBe('Cadets · All classes');
    expect(noticeAudienceLabel({ toStaff: true, cadetScope: 'selected_classes', classIds: ['c1', 'c2'] }, labels)).toBe('Staff and cadets · Class 1, Class 2');
    expect(noticeAudienceLabel({ toStaff: false, cadetScope: 'selected_classes', classIds: ['c1', 'gone'] }, labels)).toBe('Cadets · 2 classes');
    expect(noticeAudienceLabel({ toStaff: false, cadetScope: 'selected_classes', classIds: ['c1'] })).toBe('Cadets · 1 class');
  });
});
