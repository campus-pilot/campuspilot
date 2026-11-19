import { describe, expect, it } from 'vitest';
import { ORPCError } from '@orpc/server';

import { toRpcError } from '../../../errors';
import {
  EXAM_NAME_TAKEN_REASON,
  isExamNameTakenError,
} from '../exam/exam-definition.contract';
import {
  SESSION_STALE_MESSAGE,
  SESSION_STALE_REASON,
  isSessionStaleError,
  sessionVersionToken,
} from './session.contract';
import { updateSchoolSessionInputSchema } from './session.dto';

describe('isSessionStaleError', () => {
  it('is true only for CONFLICT carrying the stale-session reason', () => {
    const stale = new ORPCError('CONFLICT', {
      message: SESSION_STALE_MESSAGE,
      data: { reason: SESSION_STALE_REASON },
    });
    expect(isSessionStaleError(stale)).toBe(true);
    expect(isSessionStaleError(toRpcError(stale))).toBe(true);
    expect(isExamNameTakenError(stale)).toBe(false);
    expect(
      isSessionStaleError(
        new ORPCError('CONFLICT', { data: { reason: EXAM_NAME_TAKEN_REASON } }),
      ),
    ).toBe(false);
    expect(
      isSessionStaleError(new ORPCError('FORBIDDEN', { data: { reason: SESSION_STALE_REASON } })),
    ).toBe(false);
    expect(isSessionStaleError(new ORPCError('CONFLICT', { message: SESSION_STALE_MESSAGE }))).toBe(
      false,
    );
    for (const value of [null, undefined, 'SESSION_STALE', { code: 'CONFLICT' }])
      expect(isSessionStaleError(value)).toBe(false);
  });

  it('is false for the CONFLICTs the shared error mapping makes from database failures', () => {
    for (const code of ['23505', '40001', '40P01'])
      expect(isSessionStaleError(toRpcError({ message: 'database', cause: { code } }))).toBe(false);
  });
});

describe('sessionVersionToken', () => {
  it('is the same instant at millisecond precision whatever form it arrives in', () => {
    const updatedAt = new Date('2026-04-01T10:00:00.123Z');
    expect(sessionVersionToken(updatedAt)).toBe('2026-04-01T10:00:00.123Z');
    expect(sessionVersionToken('2026-04-01T10:00:00.123Z')).toBe('2026-04-01T10:00:00.123Z');
    expect(sessionVersionToken('2026-04-01T10:00:00Z')).toBe(
      sessionVersionToken(new Date('2026-04-01T10:00:00.000Z')),
    );
    expect(sessionVersionToken(updatedAt)).not.toBe(
      sessionVersionToken(new Date('2026-04-01T10:00:00.124Z')),
    );
  });

  it('is null for a session that was never updated', () => {
    expect(sessionVersionToken(null)).toBeNull();
    expect(sessionVersionToken(undefined)).toBeNull();
  });
});

describe('updateSession expectedUpdatedAt input', () => {
  const scope = { schoolId: 'school', sessionId: 'session' };

  it('is optional, accepts an ISO instant or null, and is not a field to update on its own', () => {
    expect(
      updateSchoolSessionInputSchema.safeParse({ ...scope, sessionEndYear: 2028 }).success,
    ).toBe(true);
    for (const expectedUpdatedAt of ['2026-04-01T10:00:00.123Z', '2026-04-01T10:00:00Z', null])
      expect(
        updateSchoolSessionInputSchema.safeParse({
          ...scope,
          sessionEndYear: 2028,
          expectedUpdatedAt,
        }).success,
      ).toBe(true);
    expect(
      updateSchoolSessionInputSchema.safeParse({
        ...scope,
        expectedUpdatedAt: '2026-04-01T10:00:00.123Z',
      }).success,
    ).toBe(false);
  });

  it('refuses a value that is not an ISO instant', () => {
    for (const expectedUpdatedAt of ['yesterday', '2026-04-01', 12])
      expect(
        updateSchoolSessionInputSchema.safeParse({
          ...scope,
          sessionEndYear: 2028,
          expectedUpdatedAt,
        }).success,
      ).toBe(false);
  });
});
