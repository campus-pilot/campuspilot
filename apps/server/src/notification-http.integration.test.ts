import { createTestSchool } from '@campuspilot/api/test/fixtures';
import { describe, expect, it } from 'vitest';

import { app } from './http';

describe('notification HTTP routes', () => {
  it('serves the per-school Cadet manifest on /blob', async () => {
    const school = await createTestSchool({ name: 'Cedar School' });
    const response = await app.request(`/blob/school/${school.id}/cadet.webmanifest`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/manifest+json');
    expect(((await response.json()) as { short_name: string }).short_name).toBe('Cedar School');
  });

  it('mounts the WhatsApp webhook, closed while its secrets are not configured', async () => {
    // The test environment sets no WHATSAPP_* values, as in local development.
    expect((await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1')).status).toBe(404);
    expect((await app.request('/webhooks/whatsapp', { method: 'POST', body: '{}' })).status).toBe(404);
  });
});
