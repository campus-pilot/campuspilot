import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SCHOOL_NO_PLAN_MESSAGE,
  SCHOOL_SUSPENDED_MESSAGE,
} from '@campuspilot/api/school-access/school-access.contract';
import { READ_ONLY_SCHOOL_MESSAGES, readOnlySchoolReason, trialEndingNotice } from './school-plan-banner-model';

test('a school is read-only when it is suspended or has no plan, and the suspension wins', () => {
  assert.equal(readOnlySchoolReason({ isSuspended: false, hasActivePlan: true }), null);
  assert.equal(readOnlySchoolReason({ isSuspended: false, hasActivePlan: false }), 'SCHOOL_NO_PLAN');
  assert.equal(readOnlySchoolReason({ isSuspended: true, hasActivePlan: true }), 'SCHOOL_SUSPENDED');
  assert.equal(readOnlySchoolReason({ isSuspended: true, hasActivePlan: false }), 'SCHOOL_SUSPENDED');
  assert.equal(READ_ONLY_SCHOOL_MESSAGES.SCHOOL_NO_PLAN, SCHOOL_NO_PLAN_MESSAGE);
  assert.equal(READ_ONLY_SCHOOL_MESSAGES.SCHOOL_SUSPENDED, SCHOOL_SUSPENDED_MESSAGE);
});

test('a trial is announced only in its last seven days, with its end day in IST', () => {
  const now = new Date('2026-12-11T06:00:00Z');
  // Ends 17 Dec 23:59:59 IST, which is 17 Dec 18:29:59 UTC: within seven days of now.
  assert.equal(
    trialEndingNotice('2026-12-17T18:29:59.000Z', now),
    'Your trial ends on 17 Dec. Contact CampusPilot to keep using these features.',
  );
  // The UTC day differs from the IST day: 12 Dec 20:00 UTC is 13 Dec in IST.
  assert.match(trialEndingNotice('2026-12-12T20:00:00.000Z', now) ?? '', /ends on 13 Dec\./);
  // More than seven days away, already over, or no trial giving the plan: nothing.
  assert.equal(trialEndingNotice('2026-12-18T06:00:01.000Z', now), null);
  assert.equal(trialEndingNotice('2026-12-11T05:00:00.000Z', now), null);
  assert.equal(trialEndingNotice(null, now), null);
});
