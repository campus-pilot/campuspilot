import { describe, expect, it } from 'vitest';

import {
  OUTDATED_MESSAGE,
  configsDiffer,
  newerSession,
  sessionDraftState,
} from './session-draft-model';
import type { SchoolSessionDto, SessionConfig } from './types';

function session(updatedAt: Date | string | null, sessionConfig: SessionConfig | null): SchoolSessionDto {
  return {
    id: 'session-1',
    schoolId: 'school-1',
    sessionStartYear: 2026,
    sessionEndYear: 2027,
    sessionConfig,
    isActive: true,
    createdAt: null,
    updatedAt,
  };
}

const loaded = session(new Date('2026-04-01T10:00:00.000Z'), {
  examConfig: { first_term: { name: 'First Term', order: 1 } },
});
/** The same session after an exam was created from the Examinations list. */
const changedElsewhere = session(new Date('2026-04-01T10:05:00.000Z'), {
  examConfig: {
    first_term: { name: 'First Term', order: 1 },
    unit_test_1: { name: 'Unit Test 1', order: 2 },
  },
});
const edited: SessionConfig = {
  examConfig: { first_term: { name: 'First Term Exam', order: 1 } },
};

describe('settings draft', () => {
  it('shows the newest known session while nothing is edited', () => {
    const state = sessionDraftState({ session: changedElsewhere, lastSaved: null, edits: null, refusal: null });
    expect(state.draft).toBe(changedElsewhere.sessionConfig);
    expect(state.basedOn).toBe(changedElsewhere);
    expect(state).toMatchObject({ isDirty: false, isOutdated: false, needsReview: false, message: null });
  });

  it('keeps the edits and the session they were made on after a refetch, and asks to load the latest', () => {
    const state = sessionDraftState({
      session: changedElsewhere,
      lastSaved: null,
      edits: { config: edited, basedOn: loaded },
      refusal: null,
    });
    // The edits stay on screen; nothing is replaced by itself.
    expect(state.draft).toBe(edited);
    expect(state.basedOn).toBe(loaded);
    expect(state).toMatchObject({
      isDirty: true,
      isOutdated: true,
      needsReview: true,
      message: OUTDATED_MESSAGE,
    });
  });

  it('shows a stale refusal, and keeps asking to review after it even before the refetch arrives', () => {
    const state = sessionDraftState({
      session: loaded,
      lastSaved: null,
      edits: { config: edited, basedOn: loaded },
      refusal: { message: 'Changed elsewhere.', reviewLatest: true },
    });
    expect(state).toMatchObject({ isOutdated: false, needsReview: true, message: 'Changed elsewhere.' });
  });

  it('lets the user correct and save again after a refusal that is about their own edit', () => {
    const state = sessionDraftState({
      session: loaded,
      lastSaved: null,
      edits: { config: edited, basedOn: loaded },
      refusal: { message: 'Name taken.', reviewLatest: false },
    });
    expect(state).toMatchObject({ isDirty: true, needsReview: false, message: 'Name taken.' });
  });

  it('compares dates and ISO strings of updatedAt as instants', () => {
    const state = sessionDraftState({
      session: session('2026-04-01T10:00:00.000Z', loaded.sessionConfig),
      lastSaved: null,
      edits: { config: edited, basedOn: loaded },
      refusal: null,
    });
    expect(state.isOutdated).toBe(false);
  });
});

describe('newerSession', () => {
  it('prefers the saved session until the app has refetched it', () => {
    expect(newerSession(loaded, changedElsewhere)).toBe(changedElsewhere);
    expect(newerSession(changedElsewhere, loaded)).toBe(changedElsewhere);
    expect(newerSession(loaded, null)).toBe(loaded);
    // Once the refetch has the same version, the app's copy is used.
    expect(newerSession(changedElsewhere, { ...changedElsewhere })).toBe(changedElsewhere);
    // Another session's save never stands in for this one.
    expect(newerSession(loaded, { ...changedElsewhere, id: 'session-2' })).toBe(loaded);
  });

  it('treats a session never updated as the oldest', () => {
    expect(newerSession(session(null, null), loaded)).toBe(loaded);
  });
});

describe('configsDiffer', () => {
  it('treats missing sections as their defaults', () => {
    expect(configsDiffer({ examConfig: {} }, { examConfig: {}, gradingScale: {}, coScholasticAreas: {}, attendanceTracking: { enabled: false } })).toBe(false);
    expect(configsDiffer(loaded.sessionConfig, edited)).toBe(true);
    expect(configsDiffer(null, null)).toBe(false);
  });
});
