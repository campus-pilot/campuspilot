import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppShellBreadcrumb } from '@campuspilot/components/app-shell';
import { isMarketplacePath, marketplaceBreadcrumbs } from './marketplace-breadcrumbs';

const params = (documentType = '', designName = '') => ({ schoolId: 's', documentType, slug: '', designName });
/** Each crumb's id, label (text crumbs only) and link. */
const trail = (crumbs: AppShellBreadcrumb[]) =>
  crumbs.map((crumb) => [crumb.id, typeof crumb.label === 'string' ? crumb.label : null, crumb.href]);

describe('marketplace breadcrumbs', () => {
  it('matches the root, a type and a design, and nothing else', () => {
    assert.equal(isMarketplacePath('/school/s/marketplace/templates'), true);
    assert.equal(isMarketplacePath('/school/s/marketplace/templates/bill'), true);
    assert.equal(isMarketplacePath('/school/s/marketplace/templates/bill/bill-classic'), true);
    assert.equal(isMarketplacePath('/school/s/marketplace/templates/bill/bill-classic/extra'), false);
    assert.equal(isMarketplacePath('/school/s/marketplace/templates/'), false);
    assert.equal(isMarketplacePath('/school/s/marketplace'), false);
    assert.equal(isMarketplacePath('/school/s/settings/templates/bill'), false);
  });

  it('ends at the marketplace on its root', () => {
    assert.deepEqual(trail(marketplaceBreadcrumbs(params())), [
      ['school-home', null, '/school/s'],
      ['template-marketplace', 'Template marketplace', undefined],
    ]);
  });

  it('links the marketplace and ends at the type on a type', () => {
    assert.deepEqual(trail(marketplaceBreadcrumbs(params('bill'))), [
      ['school-home', null, '/school/s'],
      ['template-marketplace', 'Template marketplace', '/school/s/marketplace/templates'],
      ['marketplace-type', 'Bills', undefined],
    ]);
  });

  it('links the type and ends at the design when its name is known', () => {
    assert.deepEqual(trail(marketplaceBreadcrumbs(params('bill', 'Classic'))), [
      ['school-home', null, '/school/s'],
      ['template-marketplace', 'Template marketplace', '/school/s/marketplace/templates'],
      ['marketplace-type', 'Bills', '/school/s/marketplace/templates/bill'],
      ['marketplace-design', 'Classic', undefined],
    ]);
  });

  it('ends at the marketplace for an address that is not a document type', () => {
    assert.deepEqual(trail(marketplaceBreadcrumbs(params('nope', 'Classic'))).map(([id]) => id), ['school-home', 'template-marketplace']);
  });
});
