import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppShellNavigationEntry, AppShellNavigationItem } from '@campuspilot/components/app-shell';

// The entries' gates import `@/lib/orpc`, which reads the app's public
// settings when it is imported (any valid URL will do; this test never calls
// the server), so the navigation is imported only after they are set.
process.env.NEXT_PUBLIC_SERVER_URL ??= 'http://localhost:3100';
process.env.NEXT_PUBLIC_MCP_URL ??= 'http://localhost:3100/mcp';
process.env.NEXT_PUBLIC_WEBSITE_URL ??= 'http://localhost:5174';
const { marketplaceNavigation } = await import('./marketplace-navigation');

const designs = [
  { slug: 'bill-classic', name: 'Classic' },
  { slug: 'bill-modern', name: 'Modern' },
];
const items = (entries: AppShellNavigationEntry[]) =>
  entries.map((entry) => {
    assert.equal(entry.type, 'item');
    return entry as AppShellNavigationItem;
  });
const typeItem = (entries: AppShellNavigationEntry[], id: string) => {
  const item = items(entries).find((entry) => entry.id === id);
  assert.ok(item);
  return item;
};

describe('marketplace navigation', () => {
  it('puts Back to settings first, then one item per type the school has, in order', () => {
    const entries = marketplaceNavigation({ schoolId: 'school', types: ['report_card', 'bill', 'notice'], openType: 'bill', designs });
    assert.deepEqual(
      entries.map((entry) => entry.id),
      ['back-to-settings', 'marketplace-report_card', 'marketplace-bill', 'marketplace-notice'],
    );
    assert.deepEqual(
      items(entries).slice(1).map((item) => [item.label, item.href]),
      [
        ['Report cards', '/school/school/marketplace/templates/report_card'],
        ['Bills', '/school/school/marketplace/templates/bill'],
        ['Notices', '/school/school/marketplace/templates/notice'],
      ],
    );
  });

  it('goes back to the settings template of the type being browsed', () => {
    const [back] = items(marketplaceNavigation({ schoolId: 'school', types: ['report_card'], openType: 'report_card', designs: [] }));
    assert.equal(back?.label, 'Back to settings');
    // Settings slugs are mapped explicitly, not derived from the type.
    assert.equal(back?.href, '/school/school/settings/templates/examination');
  });

  it('goes back to Settings while no type is open', () => {
    const [back] = items(marketplaceNavigation({ schoolId: 'school', types: ['report_card'], openType: null, designs: [] }));
    assert.equal(back?.href, '/school/school/settings');
  });

  it('is never shown as the current page', () => {
    const [back] = items(marketplaceNavigation({ schoolId: 'school', types: ['bill'], openType: 'bill', designs }));
    assert.equal(back?.isActive?.(back.href), false);
    assert.equal(back?.isActive?.('/school/school/marketplace/templates/bill'), false);
  });

  it('expands only the open type, with its designs as sub-items and no in-use mark', () => {
    const entries = marketplaceNavigation({ schoolId: 'school', types: ['report_card', 'bill'], openType: 'bill', designs });
    assert.deepEqual(typeItem(entries, 'marketplace-report_card').items, []);
    assert.deepEqual(
      typeItem(entries, 'marketplace-bill').items?.map((item) => [item.label, item.href]),
      [
        ['Classic', '/school/school/marketplace/templates/bill/bill-classic'],
        ['Modern', '/school/school/marketplace/templates/bill/bill-modern'],
      ],
    );
  });

  it('gates every type on a template read permission', () => {
    const entries = marketplaceNavigation({ schoolId: 'school', types: ['report_card', 'bill'], openType: null, designs: [] });
    for (const item of items(entries).slice(1)) assert.equal(typeof item.wrap, 'function');
  });
});
