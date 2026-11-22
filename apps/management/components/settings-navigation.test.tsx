import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppShellNavigationEntry } from '@campuspilot/components/app-shell';

// The entries' gates import `@/lib/orpc`, which reads the app's public
// settings when it is imported (any valid URL will do; this test never calls
// the server), so the navigation is imported only after they are set.
process.env.NEXT_PUBLIC_SERVER_URL ??= 'http://localhost:3100';
process.env.NEXT_PUBLIC_MCP_URL ??= 'http://localhost:3100/mcp';
process.env.NEXT_PUBLIC_WEBSITE_URL ??= 'http://localhost:5174';
const { settingsNavigation } = await import('./settings-navigation');

const everything = () => true;
const ids = (entries: AppShellNavigationEntry[]) => entries.map((entry) => entry.id);
const backItem = (entries: AppShellNavigationEntry[]) => {
  const [first] = entries;
  assert.ok(first && first.type === 'item');
  return first;
};

describe('settings navigation', () => {
  it('puts Back to dashboard first, once', () => {
    const entries = settingsNavigation({ schoolId: 'school', canViewSessions: true, has: everything, activeSessionId: 'active' });
    assert.deepEqual(ids(entries), ['back-to-dashboard', 'school-settings', 'admission-documents', 'session-settings', 'assistant-settings', 'usage', 'templates']);
    assert.equal(backItem(entries).label, 'Back to dashboard');
  });

  it('stays first whichever other entries the school and user have', () => {
    const entries = settingsNavigation({ schoolId: 'school', canViewSessions: false, has: () => false });
    assert.deepEqual(ids(entries), ['back-to-dashboard', 'school-settings', 'admission-documents', 'assistant-settings', 'usage']);
  });

  it('opens the dashboard of the selected session, not the active one', () => {
    const entries = settingsNavigation({ schoolId: 'school', canViewSessions: true, has: everything, activeSessionId: 'active', selectedSessionId: 'chosen' });
    assert.equal(backItem(entries).href, '/school/school/sessions/chosen');
  });

  it("opens the school's home while no session is known", () => {
    const entries = settingsNavigation({ schoolId: 'school', canViewSessions: false, has: everything });
    assert.equal(backItem(entries).href, '/school/school');
  });

  it('is never shown as the current page', () => {
    const item = backItem(settingsNavigation({ schoolId: 'school', canViewSessions: false, has: everything, selectedSessionId: 'chosen' }));
    assert.equal(item.isActive?.('/school/school/settings'), false);
    assert.equal(item.isActive?.(item.href), false);
  });
});
