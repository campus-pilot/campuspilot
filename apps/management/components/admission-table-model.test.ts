import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUnfilteredAdmissionList } from './admission-table-model';

test('the default Registered filter counts as unfiltered', () => {
  assert.equal(isUnfilteredAdmissionList({ filters: { registrationStatus: 'registered' } }), true);
});

test('no filters at all count as unfiltered', () => {
  assert.equal(isUnfilteredAdmissionList({}), true);
  assert.equal(isUnfilteredAdmissionList({ filters: { classId: undefined } }), true);
});

test('a search counts as filtered', () => {
  assert.equal(isUnfilteredAdmissionList({ searchQuery: 'asha', filters: { registrationStatus: 'registered' } }), false);
});

test('Unregistered, a chosen session and every other filter count as filtered', () => {
  assert.equal(isUnfilteredAdmissionList({ filters: { registrationStatus: 'unregistered' } }), false);
  assert.equal(isUnfilteredAdmissionList({ filters: { registrationStatus: 'registered', sessionId: 's1' } }), false);
  assert.equal(isUnfilteredAdmissionList({ filters: { placementStatus: 'unassigned' } }), false);
});
