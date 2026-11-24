import { db } from '@campuspilot/db';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createRegularUserSession,
  createTestClient,
  createTestSchool,
  type UserSession,
} from '../../../../test/fixtures';
import { selectedTemplateSlugs } from '../../../../test/documents';
import { DEFAULT_DOCUMENT_TEMPLATE_SLUGS } from '../../school/document/document.catalog';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { artifactTable, schoolDocumentTemplateTable } from '@campuspilot/db/schema/artifact';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';

describe('systemAdmin.school Router Integration', () => {
  let adminSession: UserSession;
  let regularSession: UserSession;

  beforeAll(async () => {
    adminSession = await createAdminSession();
    regularSession = await createRegularUserSession();
  });

  describe('addSchool', () => {
    it('allows platform admin to create a new school', async () => {
      const client = createTestClient(adminSession);
      const slug = `school-add-${randomUUID().toLowerCase()}`;

      const created = await client.systemAdmin.addSchool({
        slug,
        name: 'Greenwood High',
        location: 'New York, NY',
        registrationNo: 'REG-12345',
        tier: 'pro',
      });

      expect(created).toBeDefined();
      expect(created.id).toBeDefined();
      expect(created.slug).toBe(slug);
      expect(created.name).toBe('Greenwood High');
      expect(created.location).toBe('New York, NY');
      expect(created.registrationNo).toBe('REG-12345');
      expect(created.hasCompletedOnboarding).toBe(false);
      expect(created).toMatchObject({ subscribedTier: 'pro', planTier: 'pro', planSource: 'standing', period: null });
      // A new school is not suspended.
      expect(created.suspendedAt).toBeNull();
      expect(created.suspendedReason).toBeNull();
      // Every new school starts with the CampusPilot Standard templates selected.
      expect(await selectedTemplateSlugs(created.id)).toEqual(DEFAULT_DOCUMENT_TEMPLATE_SLUGS);
    });

    it('rejects invalid slug format with validation error', async () => {
      const client = createTestClient(adminSession);

      await expect(
        client.systemAdmin.addSchool({
          slug: 'Invalid Slug With Spaces & Caps!',
          name: 'Invalid School',
          location: 'City',
          tier: 'plus',
        }),
      ).rejects.toThrow();
    });

    it('denies unauthenticated callers with UNAUTHORIZED', async () => {
      const anonymousClient = createTestClient(null);

      await expect(
        anonymousClient.systemAdmin.addSchool({
          slug: `school-unauth-${randomUUID().toLowerCase()}`,
          name: 'Unauth School',
          location: 'City',
          tier: 'plus',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('denies regular non-admin users with FORBIDDEN', async () => {
      const regularClient = createTestClient(regularSession);

      await expect(
        regularClient.systemAdmin.addSchool({
          slug: `school-forbidden-${randomUUID().toLowerCase()}`,
          name: 'Forbidden School',
          location: 'City',
          tier: 'plus',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });
  });

  describe('getSchool', () => {
    it('allows platform admin to retrieve an existing school', async () => {
      const school = await createTestSchool({ name: 'Acacia Academy' });
      const client = createTestClient(adminSession);

      const fetched = await client.systemAdmin.getSchool({ id: school.id });

      expect(fetched).toBeDefined();
      expect(fetched.id).toBe(school.id);
      expect(fetched.name).toBe('Acacia Academy');
    });

    it('returns NOT_FOUND for non-existent school ID', async () => {
      const client = createTestClient(adminSession);

      await expect(
        client.systemAdmin.getSchool({ id: 'non-existent-id' }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });

    it('denies non-admin users from reading school via system-admin route', async () => {
      const school = await createTestSchool();
      const regularClient = createTestClient(regularSession);

      await expect(
        regularClient.systemAdmin.getSchool({ id: school.id }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });
  });

  describe('listSchools', () => {
    it('allows platform admin to list schools with pagination and search', async () => {
      const uniqueTerm = `search_${randomUUID().toLowerCase()}`;
      await createTestSchool({ name: `Alpha ${uniqueTerm}`, location: 'North' });
      await createTestSchool({ name: `Beta ${uniqueTerm}`, location: 'South' });
      await createTestSchool({ name: 'Other School Unrelated', location: 'East' });

      const client = createTestClient(adminSession);

      const result = await client.systemAdmin.listSchools({
        searchQuery: uniqueTerm,
        limit: 10,
        page: 1,
      });

      expect(result.items.length).toBe(2);
      expect(result.pagination.totalItems).toBe(2);
      expect(result.pagination.pageSize).toBe(10);
      expect(result.items.every((s) => s.name.includes(uniqueTerm))).toBe(true);
    });

    it('filters schools by subscription tier (or none) and by suspension, and reports both on each school', async () => {
      const tag = `tier_${randomUUID().toLowerCase()}`;
      const [plus, pro, enterprise, none] = await Promise.all([
        createTestSchool({ name: `Plus ${tag}`, tier: 'plus' }),
        createTestSchool({ name: `Pro ${tag}`, tier: 'pro' }),
        createTestSchool({ name: `Enterprise ${tag}`, tier: 'enterprise' }),
        createTestSchool({ name: `None ${tag}`, tier: null }),
      ]);
      const client = createTestClient(adminSession);
      await client.systemAdmin.suspendSchool({ id: pro.id, reason: 'Sharing accounts' });

      const all = await client.systemAdmin.listSchools({ searchQuery: tag });
      expect(all.items.map((school) => [school.id, school.subscribedTier, school.suspendedAt !== null, school.suspendedReason]).sort()).toEqual(
        [
          [plus.id, 'plus', false, null],
          [pro.id, 'pro', true, 'Sharing accounts'],
          [enterprise.id, 'enterprise', false, null],
          [none.id, null, false, null],
        ].sort(),
      );
      for (const [tier, school] of [['plus', plus], ['pro', pro], ['enterprise', enterprise], [null, none]] as const) {
        const byTier = await client.systemAdmin.listSchools({ searchQuery: tag, filters: { subscribedTier: tier } });
        expect(byTier.items.map((item) => item.id)).toEqual([school.id]);
      }
      const suspended = await client.systemAdmin.listSchools({ searchQuery: tag, filters: { suspended: true } });
      expect(suspended.items.map((item) => item.id)).toEqual([pro.id]);
      const notSuspended = await client.systemAdmin.listSchools({ searchQuery: tag, filters: { suspended: false } });
      expect(notSuspended.items.map((item) => item.id).sort()).toEqual([plus.id, enterprise.id, none.id].sort());
      const both = await client.systemAdmin.listSchools({ searchQuery: tag, filters: { subscribedTier: 'pro', suspended: false } });
      expect(both.items).toEqual([]);
    });

    it('filters schools by hasCompletedOnboarding flag', async () => {
      const tag = `onboard_${randomUUID().toLowerCase()}`;
      await createTestSchool({ name: `Done ${tag}`, hasCompletedOnboarding: true });
      await createTestSchool({ name: `Pending ${tag}`, hasCompletedOnboarding: false });

      const client = createTestClient(adminSession);

      const completed = await client.systemAdmin.listSchools({
        searchQuery: tag,
        filters: { hasCompletedOnboarding: true },
      });

      expect(completed.items.length).toBe(1);
      expect(completed.items[0]!.name).toContain('Done');
      expect(completed.items[0]!.hasCompletedOnboarding).toBe(true);
    });

    it('denies regular users from listing schools', async () => {
      const regularClient = createTestClient(regularSession);

      await expect(
        regularClient.systemAdmin.listSchools({}),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });
  });

  describe('updateSchool', () => {
    it('allows platform admin to update school properties', async () => {
      const school = await createTestSchool({ name: 'Old School Name' });
      const client = createTestClient(adminSession);

      const updated = await client.systemAdmin.updateSchool({
        id: school.id,
        name: 'Updated School Name',
        hasCompletedOnboarding: true,
      });

      expect(updated.name).toBe('Updated School Name');
      expect(updated.hasCompletedOnboarding).toBe(true);
    });

    it('rejects empty update payload with validation error', async () => {
      const school = await createTestSchool();
      const client = createTestClient(adminSession);

      await expect(
        client.systemAdmin.updateSchool({ id: school.id }),
      ).rejects.toThrow();
    });

    it('returns NOT_FOUND when updating non-existent school', async () => {
      const client = createTestClient(adminSession);

      await expect(
        client.systemAdmin.updateSchool({
          id: 'non-existent-id',
          name: 'New Name',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });

    it('denies regular users from updating school', async () => {
      const school = await createTestSchool();
      const regularClient = createTestClient(regularSession);

      await expect(
        regularClient.systemAdmin.updateSchool({
          id: school.id,
          name: 'Unauthorized Update',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });
  });

  describe('deleteSchool', () => {
    it('allows platform admin to delete a school', async () => {
      const school = await createTestSchool();
      const client = createTestClient(adminSession);

      const deleted = await client.systemAdmin.deleteSchool({ id: school.id });
      expect(deleted.id).toBe(school.id);

      // Verify it no longer exists
      await expect(
        client.systemAdmin.getSchool({ id: school.id }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });

    it('deletes a school that has feature flag rows, and its flags with it', async () => {
      // Any administrator adjustment writes a row, also when it switches a
      // feature back off.
      const school = await createTestSchool({ tier: 'pro', features: ['cadet', 'notices'] });
      const client = createTestClient(adminSession);
      await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'notices', enabled: false, config: null });
      expect(await db.select().from(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, school.id))).toHaveLength(2);

      await expect(client.systemAdmin.deleteSchool({ id: school.id })).resolves.toMatchObject({ id: school.id });
      expect(await db.select().from(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, school.id))).toEqual([]);
      await expect(client.systemAdmin.getSchool({ id: school.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('deletes a new school with its default templates, and refuses one with a generated document', async () => {
      const client = createTestClient(adminSession);
      const created = await client.systemAdmin.addSchool({ slug: `school-delete-${randomUUID().toLowerCase()}`, name: 'Short-lived School', location: 'Pune', tier: 'plus' });
      const templates = await db.select().from(artifactTable).where(eq(artifactTable.schoolId, created.id));
      expect(templates.length).toBeGreaterThan(0);
      await expect(client.systemAdmin.deleteSchool({ id: created.id })).resolves.toMatchObject({ id: created.id });
      expect(await db.select().from(artifactTable).where(eq(artifactTable.schoolId, created.id))).toEqual([]);
      expect(await db.select().from(schoolDocumentTemplateTable).where(eq(schoolDocumentTemplateTable.schoolId, created.id))).toEqual([]);
      for (const template of templates)
        await expect(getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: template.s3Key }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });

      // A school with real data (here a generated PDF) still cannot be deleted, and keeps its templates.
      const used = await client.systemAdmin.addSchool({ slug: `school-used-${randomUUID().toLowerCase()}`, name: 'Used School', location: 'Pune', tier: 'plus' });
      const [revision] = await db.select().from(artifactTable).where(eq(artifactTable.schoolId, used.id)).limit(1);
      await db.insert(artifactTable).values({
        schoolId: used.id, kind: 'pdf', documentType: 'id_card', name: 'Student IDs', s3Key: `schools/${used.id}/documents/${randomUUID()}.pdf`,
        contentType: 'application/pdf', byteSize: 1, sha256: 'a'.repeat(64), templateRevisionId: revision!.id, sessionId: 'session', createdBy: adminSession.user.id,
      });
      await expect(client.systemAdmin.deleteSchool({ id: used.id })).rejects.toBeDefined();
      expect(await db.select().from(schoolDocumentTemplateTable).where(eq(schoolDocumentTemplateTable.schoolId, used.id))).not.toEqual([]);
    });

    it('returns NOT_FOUND when deleting non-existent school', async () => {
      const client = createTestClient(adminSession);

      await expect(
        client.systemAdmin.deleteSchool({ id: 'non-existent-id' }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });

    it('denies regular users from deleting school', async () => {
      const school = await createTestSchool();
      const regularClient = createTestClient(regularSession);

      await expect(
        regularClient.systemAdmin.deleteSchool({ id: school.id }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });
  });
});
