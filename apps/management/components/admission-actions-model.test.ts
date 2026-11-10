import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  admissionActionsFor,
  issuePortalPasswordConfirmation,
  issuePortalPasswordPermission,
} from './admission-actions-model';
import { permissionsSatisfied } from './require-permissions-model';

/** Whether the overflow menu's "Issue portal password" renders, as `AdmissionActions` decides it. */
function showsIssuePortalPassword(registered: boolean, results: boolean[] | undefined) {
  return (
    admissionActionsFor({ registered }).issuePortalPassword &&
    permissionsSatisfied({ isPending: false, isError: false, results }, 1)
  );
}

test('"Issue portal password" is gated by the issue permission on the admission\'s school', () => {
  assert.deepEqual(issuePortalPasswordPermission('sch_1'), {
    action: SCHOOL_ACTIONS.ISSUE_ADMISSION_CADET_PASSWORD,
    resource: { kind: 'school', schoolId: 'sch_1' },
  });
});

test('"Issue portal password" shows only when permitted, for registered and unregistered admissions', () => {
  for (const registered of [true, false]) {
    assert.equal(showsIssuePortalPassword(registered, [true]), true, `registered=${registered}`);
    assert.equal(showsIssuePortalPassword(registered, [false]), false, `registered=${registered}`);
  }
});

test('edit and unregister stay registered-only while the portal password does not', () => {
  assert.deepEqual(admissionActionsFor({ registered: true }), { edit: true, unregister: true, issuePortalPassword: true });
  assert.deepEqual(admissionActionsFor({ registered: false }), { edit: false, unregister: false, issuePortalPassword: true });
});

test('a permission answer already held survives a failed refetch, granted or denied (review U1)', () => {
  // What TanStack Query reports after a background refetch failed: isError with the last good results.
  assert.equal(permissionsSatisfied({ isPending: false, isError: true, results: [true] }, 1), true);
  assert.equal(permissionsSatisfied({ isPending: false, isError: true, results: [false] }, 1), false);
  assert.equal(permissionsSatisfied({ isPending: false, isError: true, results: [true, false] }, 2), false);
});

test('permission gates fail closed while pending, on error, and on incomplete answers', () => {
  assert.equal(permissionsSatisfied({ isPending: true, isError: false, results: undefined }, 1), false);
  assert.equal(permissionsSatisfied({ isPending: false, isError: true, results: undefined }, 1), false);
  assert.equal(permissionsSatisfied({ isPending: false, isError: false, results: [] }, 1), false);
  assert.equal(permissionsSatisfied({ isPending: false, isError: false, results: [true, false] }, 2), false);
  assert.equal(permissionsSatisfied({ isPending: false, isError: false, results: [true, false] }, 2, 'any'), true);
  assert.equal(permissionsSatisfied({ isPending: false, isError: false, results: [true, true] }, 2), true);
});

test('the confirmation is worded to be true for a first password and for a reset', () => {
  const confirmation = issuePortalPasswordConfirmation('Asha Kumari', false);
  assert.equal(confirmation.title, 'Issue a new Cadet Portal password?');
  assert.equal(
    confirmation.description,
    'Asha Kumari gets a new Cadet Portal password. If one was issued before, it stops working and Asha Kumari is signed out of the Cadet Portal everywhere, including connected AI apps.',
  );
  // Never claims an existing password, which a first issue does not have.
  assert.doesNotMatch(confirmation.description, /current password|your password/i);
  assert.equal(confirmation.confirmLabel, 'Issue password');
  assert.equal(issuePortalPasswordConfirmation('Asha Kumari', true).confirmLabel, 'Issuing…');
});
