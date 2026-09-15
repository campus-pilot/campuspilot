import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createRegularUserSession,
  createTestClient,
  createTestSchool,
  type UserSession,
} from '../../../../test/fixtures';

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
      });

      expect(created).toBeDefined();
      expect(created.id).toBeDefined();
      expect(created.slug).toBe(slug);
      expect(created.name).toBe('Greenwood High');
      expect(created.location).toBe('New York, NY');
      expect(created.registrationNo).toBe('REG-12345');
      expect(created.hasCompletedOnboarding).toBe(false);
    });

    it('rejects invalid slug format with validation error', async () => {
      const client = createTestClient(adminSession);

      await expect(
        client.systemAdmin.addSchool({
          slug: 'Invalid Slug With Spaces & Caps!',
          name: 'Invalid School',
          location: 'City',
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
