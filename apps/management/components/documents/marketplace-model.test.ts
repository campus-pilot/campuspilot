import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  footprintLabel,
  marketplaceHref,
  marketplaceRequestOf,
  selectedDesignOf,
  selectedTypeOf,
} from './marketplace-model';

const search = (query: string) => new URLSearchParams(query);

test('reads the type, design and preview the address asks for, refusing what is not one', () => {
  assert.deepEqual(marketplaceRequestOf(search('type=id_card&template=id_card-modern&preview=1')), {
    type: 'id_card',
    template: 'id_card-modern',
    preview: true,
  });
  assert.deepEqual(marketplaceRequestOf(search('type=nope&template=..%2Fsecret&preview=yes')), {
    type: null,
    template: null,
    preview: false,
  });
  assert.deepEqual(marketplaceRequestOf(search('')), { type: null, template: null, preview: false });
});

test('names a design only with its type and the preview only with its design', () => {
  assert.equal(marketplaceHref('s 1'), '/school/s%201/marketplace/templates');
  assert.equal(marketplaceHref('s', { type: 'notice' }), '/school/s/marketplace/templates?type=notice');
  assert.equal(
    marketplaceHref('s', { type: 'notice', template: 'notice-compact', preview: true }),
    '/school/s/marketplace/templates?type=notice&template=notice-compact&preview=1',
  );
  assert.equal(marketplaceHref('s', { type: 'notice', preview: true }), '/school/s/marketplace/templates?type=notice');
  assert.equal(marketplaceHref('s', { template: 'notice-compact', preview: true }), '/school/s/marketplace/templates');
  // What the address reads back is what was asked for.
  const href = marketplaceHref('s', { type: 'bill', template: 'bill-classic', preview: true });
  assert.deepEqual(marketplaceRequestOf(new URL(href, 'http://x').searchParams), { type: 'bill', template: 'bill-classic', preview: true });
});

test('opens the requested type when the school has it, else its first type', () => {
  assert.equal(selectedTypeOf('notice', ['report_card', 'notice']), 'notice');
  assert.equal(selectedTypeOf('notice', ['report_card', 'id_card']), 'report_card');
  assert.equal(selectedTypeOf(null, ['bill']), 'bill');
  assert.equal(selectedTypeOf('bill', []), null);
});

test('shows the requested design, else the one in use, else the first, and says when a request is not listed', () => {
  const listed = ['a', 'b', 'c'];
  assert.deepEqual(selectedDesignOf('b', listed, 'c'), { slug: 'b', missing: false });
  assert.deepEqual(selectedDesignOf(null, listed, 'c'), { slug: 'c', missing: false });
  assert.deepEqual(selectedDesignOf(null, listed, null), { slug: 'a', missing: false });
  // A design in use that the catalog no longer lists is not shown as if it were.
  assert.deepEqual(selectedDesignOf(null, listed, 'gone'), { slug: 'a', missing: false });
  assert.deepEqual(selectedDesignOf('gone', listed, 'c'), { slug: 'c', missing: true });
  assert.deepEqual(selectedDesignOf('gone', [], null), { slug: null, missing: true });
});

test('says the paper a design prints on, and that a Notice design leaves it to each notice', () => {
  assert.equal(footprintLabel({ documentType: 'admit_card', pageSize: 'half' }), 'Half A4 · two per sheet');
  assert.equal(footprintLabel({ documentType: 'report_card', pageSize: 'full' }), 'Full A4 · one per sheet');
  assert.equal(footprintLabel({ documentType: 'notice', pageSize: 'full' }), 'Full or half A4 · each notice chooses');
});
