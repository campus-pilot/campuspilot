import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SCHOOL_NO_PLAN_MESSAGE,
  SCHOOL_SUSPENDED_MESSAGE,
} from '@campuspilot/api/school-access/school-access.contract';
import { planEndingNotice, READ_ONLY_SCHOOL_MESSAGES, readOnlySchoolReason } from './school-plan-banner-model';

test('a school is read-only when it is suspended or has no plan, and the suspension wins', () => {
  assert.equal(readOnlySchoolReason({ isSuspended: false, hasActivePlan: true }), null);
  assert.equal(readOnlySchoolReason({ isSuspended: false, hasActivePlan: false }), 'SCHOOL_NO_PLAN');
  assert.equal(readOnlySchoolReason({ isSuspended: true, hasActivePlan: true }), 'SCHOOL_SUSPENDED');
  assert.equal(readOnlySchoolReason({ isSuspended: true, hasActivePlan: false }), 'SCHOOL_SUSPENDED');
  assert.equal(READ_ONLY_SCHOOL_MESSAGES.SCHOOL_NO_PLAN, SCHOOL_NO_PLAN_MESSAGE);
  assert.equal(READ_ONLY_SCHOOL_MESSAGES.SCHOOL_SUSPENDED, SCHOOL_SUSPENDED_MESSAGE);
});

test('the end of the plan is announced only in its last seven days, with its end day in IST', () => {
  const now = new Date('2026-12-11T06:00:00Z');
  const trial = (planEndsAt: string | null, hasSubscription = true) => ({ planEndsAt, planSource: 'trial' as const, hasSubscription });
  // Ends 17 Dec 23:59:59 IST, which is 17 Dec 18:29:59 UTC: within seven days of now.
  assert.equal(
    planEndingNotice(trial('2026-12-17T18:29:59.000Z'), now),
    'Your free trial ends on 17 Dec. Contact CampusPilot to keep using these features.',
  );
  // The UTC day differs from the IST day: 12 Dec 20:00 UTC is 13 Dec in IST.
  assert.match(planEndingNotice(trial('2026-12-12T20:00:00.000Z'), now) ?? '', /ends on 13 Dec\./);
  // More than seven days away, already over, or no period giving the plan: nothing.
  assert.equal(planEndingNotice(trial('2026-12-18T06:00:01.000Z'), now), null);
  assert.equal(planEndingNotice(trial('2026-12-11T05:00:00.000Z'), now), null);
  assert.equal(planEndingNotice(trial(null, false), now), null);
  // Without a standing tier the end blocks the school (no grace), and the notice says so.
  assert.equal(
    planEndingNotice({ planEndsAt: '2026-12-17T18:29:59.000Z', planSource: 'paid', hasSubscription: false }, now),
    'Your plan is paid until 17 Dec. After that the school is blocked until the next payment. Contact CampusPilot to pay for the next period.',
  );
});
