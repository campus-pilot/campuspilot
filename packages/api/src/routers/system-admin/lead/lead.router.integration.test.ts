import { db } from '@campuspilot/db';
import { leadTable } from '@campuspilot/db/schema/lead';
import { beforeAll, describe, expect, it } from 'vitest';

import { createAdminSession, createRegularUserSession, createTestClient, type TestClient } from '../../../../test/fixtures';

let admin: TestClient;
const marker = `Lead${crypto.randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  admin = createTestClient(await createAdminSession());
  await db.insert(leadTable).values([
    { form: 'book_demo', formVersion: 1, submissionId: crypto.randomUUID(), response: { name: `${marker} Older`, phone: '+919876543210' }, createdAt: new Date(Date.now() - 60_000) },
    { form: 'book_demo', formVersion: 1, submissionId: crypto.randomUUID(), response: { name: `${marker} Newer`, phone: '+919876543211' }, alertStatus: 'sent' },
  ]);
});

describe('systemAdmin.listLeads', () => {
  it('lists leads newest first with their answers', async () => {
    const result = await admin.systemAdmin.listLeads({ searchQuery: marker });
    expect(result.items.map((lead) => lead.response.name)).toEqual([`${marker} Newer`, `${marker} Older`]);
    expect(result.pagination.totalItems).toBe(2);
  });

  it('filters by alert status and searches the phone answer', async () => {
    const sent = await admin.systemAdmin.listLeads({ searchQuery: marker, filters: { alertStatus: 'sent' } });
    expect(sent.items.map((lead) => lead.response.name)).toEqual([`${marker} Newer`]);
    const byPhone = await admin.systemAdmin.listLeads({ searchQuery: '9876543211' });
    expect(byPhone.items.some((lead) => lead.response.name === `${marker} Newer`)).toBe(true);
  });

  it('is refused to anyone but a platform admin', async () => {
    const user = createTestClient(await createRegularUserSession());
    await expect(user.systemAdmin.listLeads({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
