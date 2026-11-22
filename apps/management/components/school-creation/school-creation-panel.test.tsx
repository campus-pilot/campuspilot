import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SchoolCreationStatusDto } from '@campuspilot/api/routers/school-creation/school-creation.dto';

// `@/lib/orpc` reads the app's public settings when it is imported (any valid
// URL will do; this test never calls the server), so the panel is imported
// only after they are set.
process.env.NEXT_PUBLIC_SERVER_URL ??= 'http://localhost:3100';
process.env.NEXT_PUBLIC_MCP_URL ??= 'http://localhost:3100/mcp';
process.env.NEXT_PUBLIC_WEBSITE_URL ??= 'http://localhost:5174';
const { approvalNoteOf } = await import('./school-creation-panel');

const request = {
  id: 'request',
  requestedLimit: 3,
  reason: 'We run two more branches in the city.',
  grantedLimit: 2,
  decisionNote: 'Two for now; ask again next term.',
  decidedAt: new Date('2026-11-17T10:00:00Z'),
  createdAt: new Date('2026-11-16T10:00:00Z'),
};
const status = (latestRequest: SchoolCreationStatusDto['latestRequest']): SchoolCreationStatusDto => ({
  limit: 2,
  used: 1,
  refusal: null,
  latestRequest,
});

test('the note left with an approval is shown to the person', () => {
  assert.equal(approvalNoteOf(status({ ...request, status: 'approved' })), 'Two for now; ask again next term.');
});

test('no note is shown without an approval note', () => {
  assert.equal(approvalNoteOf(status({ ...request, status: 'approved', decisionNote: null })), null);
  assert.equal(approvalNoteOf(status({ ...request, status: 'pending', grantedLimit: null, decisionNote: null, decidedAt: null })), null);
  assert.equal(approvalNoteOf(status(null)), null);
});
