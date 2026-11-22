import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contactHrefOf, landingSchoolOf, personalPaperHref, personalPapersHref, personalPlanNoticeOf, personalPlanStatusOf, personalSpaceOf, schoolEntryHrefOf } from './personal-space-model';

const school = (id: string, kind: 'school' | 'personal') => ({ id, kind });

test('the landing keeps a valid stored selection, then a school, then the personal space', () => {
  const schools = [school('p', 'personal'), school('a', 'school'), school('b', 'school')];
  assert.equal(landingSchoolOf(schools, 'b')?.id, 'b');
  assert.equal(landingSchoolOf(schools, 'p')?.id, 'p');
  assert.equal(landingSchoolOf(schools, 'gone')?.id, 'a');
  assert.equal(landingSchoolOf(schools, undefined)?.id, 'a');
  assert.equal(landingSchoolOf([school('p', 'personal')], undefined)?.id, 'p');
  assert.equal(landingSchoolOf([], undefined), undefined);
});

test('the personal space is found by its kind only', () => {
  assert.equal(personalSpaceOf([school('a', 'school'), school('p', 'personal')])?.id, 'p');
  assert.equal(personalSpaceOf([school('a', 'school')]), undefined);
});

test('a personal space opens on its papers, a school on its entry', () => {
  assert.equal(schoolEntryHrefOf(school('p 1', 'personal')), '/school/p%201/papers');
  assert.equal(schoolEntryHrefOf(school('a', 'school')), '/school/a');
  assert.equal(personalPapersHref('p'), '/school/p/papers');
  assert.equal(personalPaperHref('p', 'qp/1'), '/school/p/papers/qp%2F1');
});

test('the contact link is the website’s contact page', () => {
  assert.equal(contactHrefOf('https://campuspilot.in'), 'https://campuspilot.in/contact');
  assert.equal(contactHrefOf('http://localhost:5174/'), 'http://localhost:5174/contact');
});

test('a personal space whose trial ended or which is suspended is told to contact us', () => {
  const base = { isSuspended: false, hasActivePlan: false, planEndsAt: null, planSource: null } as const;
  assert.equal(personalPlanNoticeOf(base)?.kind, 'ended');
  assert.match(personalPlanNoticeOf(base)!.contact, /^Contact us/);
  assert.doesNotMatch(`${personalPlanNoticeOf(base)!.message} ${personalPlanNoticeOf(base)!.contact}`, /Billing|administrator/);
  assert.equal(personalPlanNoticeOf({ ...base, isSuspended: true, hasActivePlan: true })?.kind, 'ended');
  assert.equal(personalPlanStatusOf(base), 'Trial ended');
});

test('a trial is announced only in its last days, and shown as a status until then', () => {
  const now = new Date('2026-11-22T06:00:00Z');
  const ends = (days: number) => ({ isSuspended: false, hasActivePlan: true, planSource: 'trial' as const, planEndsAt: new Date(now.getTime() + days * 86_400_000).toISOString() });
  assert.equal(personalPlanNoticeOf(ends(20), now), null);
  assert.equal(personalPlanNoticeOf(ends(3), now)?.kind, 'ending');
  assert.match(personalPlanStatusOf(ends(20)) ?? '', /^Trial until /);
  assert.equal(personalPlanStatusOf({ isSuspended: false, hasActivePlan: true, planSource: 'standing', planEndsAt: null }), null);
});
