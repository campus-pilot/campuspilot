import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORPCError } from '@orpc/client';
import { EXAM_NAME_TAKEN_REASON } from '@campuspilot/api/routers/school/exam/exam-definition.contract';
import {
  SCHOOL_NO_PLAN_MESSAGE,
  SCHOOL_SUSPENDED_MESSAGE,
  SCHOOL_SUSPENDED_REASON,
  SCHOOL_NO_PLAN_REASON,
} from '@campuspilot/api/school-access/school-access.contract';
import { SESSION_STALE_REASON } from '@campuspilot/api/routers/school/session/session.contract';
import {
  SESSION_EXAM_NAME_TAKEN_MESSAGE,
  SESSION_SAVE_UNCERTAIN_MESSAGE,
  SESSION_STALE_SAVE_MESSAGE,
  sessionSaveRefusal,
  toUpdateSessionInput,
} from './session-save-model';

test('a stale save keeps the edits but asks to load the latest settings, after reading the session again', () => {
  assert.deepEqual(
    sessionSaveRefusal(
      new ORPCError('CONFLICT', { message: 'stale', data: { reason: SESSION_STALE_REASON } }),
    ),
    { message: SESSION_STALE_SAVE_MESSAGE, reviewLatest: true, refetch: true },
  );
});

test('a taken exam name reads the session again and leaves the edits editable', () => {
  assert.deepEqual(
    sessionSaveRefusal(
      new ORPCError('CONFLICT', { message: 'taken', data: { reason: EXAM_NAME_TAKEN_REASON } }),
    ),
    { message: SESSION_EXAM_NAME_TAKEN_MESSAGE, reviewLatest: false, refetch: true },
  );
});

test('a read-only school shows its fixed message', () => {
  assert.deepEqual(
    sessionSaveRefusal(new ORPCError('FORBIDDEN', { data: { reason: SCHOOL_SUSPENDED_REASON } })),
    { message: SCHOOL_SUSPENDED_MESSAGE, reviewLatest: false, refetch: false },
  );
  assert.deepEqual(
    sessionSaveRefusal(new ORPCError('FORBIDDEN', { data: { reason: SCHOOL_NO_PLAN_REASON } })),
    { message: SCHOOL_NO_PLAN_MESSAGE, reviewLatest: false, refetch: false },
  );
});

test('another refusal shows the server message, including a CONFLICT without a reason', () => {
  assert.deepEqual(
    sessionSaveRefusal(new ORPCError('FORBIDDEN', { message: 'Only school exam administrators can change exam definitions.' })),
    {
      message: 'Only school exam administrators can change exam definitions.',
      reviewLatest: false,
      refetch: false,
    },
  );
  assert.deepEqual(
    sessionSaveRefusal(new ORPCError('CONFLICT', { message: 'The examination “Unit Test 1” (unit_test_1) has data.' })),
    {
      message: 'The examination “Unit Test 1” (unit_test_1) has data.',
      reviewLatest: false,
      refetch: false,
    },
  );
});

test('an unknown outcome asks to load the latest settings, after reading the session again', () => {
  for (const error of [
    new ORPCError('INTERNAL_SERVER_ERROR', { message: 'boom' }),
    new TypeError('Failed to fetch'),
  ])
    assert.deepEqual(sessionSaveRefusal(error), {
      message: SESSION_SAVE_UNCERTAIN_MESSAGE,
      reviewLatest: true,
      refetch: true,
    });
});

test('the request always carries the version the edit started from', () => {
  const scope = { schoolId: 'school-1', sessionId: 'session-1' };
  const sessionConfig = { examConfig: { first_term: { name: 'First Term', order: 1 } } };
  assert.deepEqual(
    toUpdateSessionInput(scope, {
      sessionConfig,
      basedOnUpdatedAt: new Date('2026-04-01T10:00:00.123Z'),
    }),
    { ...scope, sessionConfig, expectedUpdatedAt: '2026-04-01T10:00:00.123Z' },
  );
  assert.deepEqual(
    toUpdateSessionInput(scope, { sessionConfig: null, basedOnUpdatedAt: null }),
    { ...scope, sessionConfig: null, expectedUpdatedAt: null },
  );
});
