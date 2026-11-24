import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';

import {
  defaultDesignOf,
  footprintLabel,
  landingTypeOf,
  legacyMarketplaceRedirect,
  legacyMarketplaceRequestOf,
  marketplaceHref,
  marketplaceTypesOf,
  offeredTypeOf,
} from './marketplace-model';

const search = (query: string) => new URLSearchParams(query);
const ready = (...features: SchoolFeatureKey[]) => (feature: SchoolFeatureKey) =>
  ({ enabled: features.includes(feature), status: 'ready' as const });

test('names a type, a design and its preview as path segments, a design only with its type and the preview only with its design', () => {
  assert.equal(marketplaceHref('s 1'), '/school/s%201/marketplace/templates');
  assert.equal(marketplaceHref('s', { type: 'notice' }), '/school/s/marketplace/templates/notice');
  assert.equal(marketplaceHref('s', { type: 'notice', template: 'notice-compact' }), '/school/s/marketplace/templates/notice/notice-compact');
  assert.equal(
    marketplaceHref('s', { type: 'notice', template: 'notice-compact', preview: true }),
    '/school/s/marketplace/templates/notice/notice-compact?preview=1',
  );
  assert.equal(marketplaceHref('s', { type: 'notice', preview: true }), '/school/s/marketplace/templates/notice');
  assert.equal(marketplaceHref('s', { template: 'notice-compact', preview: true }), '/school/s/marketplace/templates');
  // A slug is one path segment, whatever it holds.
  assert.equal(marketplaceHref('s', { type: 'bill', template: '../secret' }), '/school/s/marketplace/templates/bill/..%2Fsecret');
});

test('reads the former query address, refusing what is not a type or a slug', () => {
  assert.deepEqual(legacyMarketplaceRequestOf(search('type=id_card&template=id_card-modern&preview=1')), {
    type: 'id_card',
    template: 'id_card-modern',
    preview: true,
  });
  assert.deepEqual(legacyMarketplaceRequestOf(search('type=nope&preview=yes')), { type: null, template: null, preview: false });
  assert.equal(legacyMarketplaceRequestOf(search(`type=bill&template=${'a'.repeat(100)}`)).template, 'a'.repeat(100));
  assert.equal(legacyMarketplaceRequestOf(search(`type=bill&template=${'a'.repeat(101)}`)).template, null);
  assert.deepEqual(legacyMarketplaceRequestOf(search('')), { type: null, template: null, preview: false });
});

test('redirects an old query link to the matching new address, and never the root to itself', () => {
  assert.equal(
    legacyMarketplaceRedirect('s', search('type=bill&template=bill-classic&preview=1')),
    '/school/s/marketplace/templates/bill/bill-classic?preview=1',
  );
  assert.equal(legacyMarketplaceRedirect('s', search('type=bill&template=bill-classic')), '/school/s/marketplace/templates/bill/bill-classic');
  assert.equal(legacyMarketplaceRedirect('s', search('type=bill&preview=1')), '/school/s/marketplace/templates/bill');
  assert.equal(legacyMarketplaceRedirect('s', search('type=question_paper')), '/school/s/marketplace/templates/question_paper');
  assert.equal(legacyMarketplaceRedirect('s', search('template=bill-classic&preview=1')), null);
  assert.equal(legacyMarketplaceRedirect('s', search('type=nope')), null);
  assert.equal(legacyMarketplaceRedirect('s', search('')), null);
});

test('offers the types of the features the school has, in the settings order', () => {
  assert.deepEqual(marketplaceTypesOf(ready('studentManagement', 'notices', 'assistant')), {
    types: ['report_card', 'id_card', 'admit_card', 'timetable', 'bill', 'receipt', 'statement', 'notice', 'question_paper'],
    status: 'ready',
  });
  // Each type is decided from its own feature, not from which features happen to go together today.
  assert.deepEqual(marketplaceTypesOf(ready('assistant')), { types: ['question_paper'], status: 'ready' });
  assert.deepEqual(marketplaceTypesOf(ready('notices')), { types: ['notice'], status: 'ready' });
  assert.deepEqual(marketplaceTypesOf(ready()), { types: [], status: 'ready' });
});

test('waits while a feature is read and says when one could not be read, never "no templates"', () => {
  const pending = (feature: SchoolFeatureKey) =>
    feature === 'notices' ? { enabled: false, status: 'pending' as const } : { enabled: true, status: 'ready' as const };
  assert.equal(marketplaceTypesOf(pending).status, 'pending');
  const unknown = () => ({ enabled: false, status: 'unknown' as const });
  assert.deepEqual(marketplaceTypesOf(unknown), { types: [], status: 'unknown' });
});

test('opens the first type the user may read, and none when they may read none', () => {
  const types = ['report_card', 'id_card', 'bill', 'receipt'] as const;
  assert.equal(landingTypeOf(types, () => true), 'report_card');
  // A role that reads finance templates only lands on Bills, not on a refused Report cards.
  const financeOnly = (type: string) => type === 'bill' || type === 'receipt';
  assert.equal(landingTypeOf(types, financeOnly), 'bill');
  assert.equal(landingTypeOf(types, () => false), null);
  assert.equal(landingTypeOf([], () => true), null);
});

test('names the requested type only when the school has it, with no fallback', () => {
  assert.equal(offeredTypeOf('notice', ['report_card', 'notice']), 'notice');
  assert.equal(offeredTypeOf('notice', ['report_card', 'id_card']), null);
  assert.equal(offeredTypeOf(null, ['bill']), null);
});

test("opens a type on the design in use when the catalog still lists it, else the first", () => {
  const listed = ['a', 'b', 'c'];
  assert.equal(defaultDesignOf(listed, 'c'), 'c');
  assert.equal(defaultDesignOf(listed, null), 'a');
  // A design in use that the catalog no longer lists is not opened as if it were.
  assert.equal(defaultDesignOf(listed, 'gone'), 'a');
  assert.equal(defaultDesignOf([], null), null);
});

test('says the paper a design prints on, and that a Notice design leaves it to each notice', () => {
  assert.equal(footprintLabel({ documentType: 'admit_card', pageSize: 'half' }), 'Half A4 · two per sheet');
  assert.equal(footprintLabel({ documentType: 'report_card', pageSize: 'full' }), 'Full A4 · one per sheet');
  assert.equal(footprintLabel({ documentType: 'notice', pageSize: 'full' }), 'Full or half A4 · each notice chooses');
});
