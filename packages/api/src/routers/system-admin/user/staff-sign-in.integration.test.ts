import { auth as staffAuth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { eq } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { createRouterClient } from '@orpc/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { cookiesOf } from '../../../../test/cadet';
import { expectRpcCode } from '../../../../test/finance/assertions';
import { appRouter } from '../../index';
import {
  createAdminSession,
  createHandlerContext,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  type UserSession,
} from '../../../../test/fixtures';

/** A unique, valid Indian mobile number as a person would type it. */
function typedIndianMobile() {
  const digits = `98${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  return { typed: `${digits.slice(0, 5)} ${digits.slice(5)}`, e164: `+91${digits}` };
}

async function signInWithPhone(phoneNumber: string, password: string) {
  const response = await staffAuth.api.signInPhoneNumber({
    body: { phoneNumber, password },
    asResponse: true,
  });
  return { response, cookie: cookiesOf(response) };
}

async function signInWithEmail(email: string, password: string) {
  return staffAuth.api.signInEmail({ body: { email, password }, asResponse: true });
}

async function sessionOf(cookie: string) {
  return staffAuth.api.getSession({ headers: new Headers({ cookie }) });
}

describe('staff phone-number sign-in', () => {
  let school: Awaited<ReturnType<typeof createTestSchool>>;
  let otherSchool: Awaited<ReturnType<typeof createTestSchool>>;
  let principal: UserSession;
  let manager: UserSession;
  let otherPrincipal: UserSession;
  let admin: UserSession;

  beforeAll(async () => {
    school = await createTestSchool();
    otherSchool = await createTestSchool();
    principal = (await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session;
    manager = (await createSchoolStaffSession(school.id, [{ role: 'manager', meta: null }])).session;
    otherPrincipal = (await createSchoolStaffSession(otherSchool.id, [{ role: 'principal', meta: null }])).session;
    admin = await createAdminSession();
  });

  /** A teacher invited by phone into `school`, with the issued password. */
  async function invitePhoneTeacher() {
    const phone = typedIndianMobile();
    const member = await createTestClient(principal).school.inviteMember({
      schoolId: school.id,
      phoneNumber: phone.typed,
      roles: [{ role: 'teacher', meta: null }],
    });
    return { phone, member, password: member.issuedPassword! };
  }

  describe('inviting by phone number', () => {
    it('creates a phone-only account with a placeholder email and issues a password once', async () => {
      const { phone, member, password } = await invitePhoneTeacher();

      expect(member.phoneNumber).toBe(phone.e164);
      expect(member.email).toBeNull();
      expect(password).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);

      const [row] = await db.select().from(user).where(eq(user.id, member.userId));
      expect(row).toMatchObject({
        emailIsPlaceholder: true,
        phoneNumber: phone.e164,
        phoneNumberVerified: true,
        emailVerified: false,
      });
      expect(row!.email).toMatch(/@phone\.campuspilot\.invalid$/);

      const listed = await createTestClient(principal).school.listMembers({
        schoolId: school.id,
        searchQuery: phone.typed,
      });
      expect(listed.items.map((item) => item.userId)).toEqual([member.userId]);
    });

    it('signs in with the phone number and issued password, and refuses a wrong password', async () => {
      const { phone, password } = await invitePhoneTeacher();

      const signedIn = await signInWithPhone(phone.e164, password);
      expect(signedIn.response.status).toBe(200);
      expect((await sessionOf(signedIn.cookie))?.user.phoneNumber).toBe(phone.e164);

      const wrong = await signInWithPhone(phone.e164, 'not-the-password');
      expect(wrong.response.status).toBe(401);
    });

    it('does not let a person remove their own sign-in number', async () => {
      const { phone, member, password } = await invitePhoneTeacher();
      const { cookie } = await signInWithPhone(phone.e164, password);
      const response = await staffAuth.api.updateUser({
        body: { phoneNumber: null },
        headers: new Headers({ cookie }),
        asResponse: true,
      });
      expect(response.status).toBe(400);
      const [row] = await db.select().from(user).where(eq(user.id, member.userId));
      expect(row!.phoneNumber).toBe(phone.e164);
    });

    it('refuses a placeholder email typed as an invitation address', async () => {
      await expectRpcCode(
        createTestClient(principal).school.inviteMember({
          schoolId: school.id,
          email: `${randomUUID()}@phone.campuspilot.invalid`,
          roles: [{ role: 'teacher', meta: null }],
        }),
        'BAD_REQUEST',
      );
    });

    it('needs the password permission: a manager cannot invite by phone and nothing is written', async () => {
      const phone = typedIndianMobile();
      await expectRpcCode(
        createTestClient(manager).school.inviteMember({
          schoolId: school.id,
          phoneNumber: phone.typed,
          roles: [{ role: 'teacher', meta: null }],
        }),
        'FORBIDDEN',
      );
      const rows = await db.select().from(user).where(eq(user.phoneNumber, phone.e164));
      expect(rows).toHaveLength(0);
    });

    it('refuses phone invitations from AI apps and API keys, which would receive the password', async () => {
      const phone = typedIndianMobile();
      const apiKeyClient = createRouterClient(appRouter, {
        context: async () => ({
          ...createHandlerContext(principal),
          principal: { authMethod: 'apiKey' as const },
        }),
      });
      await expectRpcCode(
        apiKeyClient.school.inviteMember({
          schoolId: school.id,
          phoneNumber: phone.typed,
          roles: [{ role: 'teacher', meta: null }],
        }),
        'FORBIDDEN',
      );
      const rows = await db.select().from(user).where(eq(user.phoneNumber, phone.e164));
      expect(rows).toHaveLength(0);
    });

    it('adds an existing phone account to another school without issuing a password', async () => {
      const { phone, member } = await invitePhoneTeacher();
      const added = await createTestClient(otherPrincipal).school.inviteMember({
        schoolId: otherSchool.id,
        phoneNumber: phone.e164,
        roles: [{ role: 'teacher', meta: null }],
      });
      expect(added.userId).toBe(member.userId);
      expect(added.issuedPassword).toBeNull();
    });
  });

  describe('school.issueMemberPassword', () => {
    it('issues a new password, signs the member out everywhere, and the old one stops working', async () => {
      const { phone, member, password } = await invitePhoneTeacher();
      const before = await signInWithPhone(phone.e164, password);
      expect(await sessionOf(before.cookie)).not.toBeNull();

      const issued = await createTestClient(principal).school.issueMemberPassword({
        schoolId: school.id,
        userId: member.userId,
      });
      expect(issued).toMatchObject({ userId: member.userId, phoneNumber: phone.e164, email: null });
      expect(issued.password).not.toBe(password);

      expect(await sessionOf(before.cookie)).toBeNull();
      expect((await signInWithPhone(phone.e164, password)).response.status).toBe(401);
      expect((await signInWithPhone(phone.e164, issued.password)).response.status).toBe(200);
    });

    it('refuses people who also belong to another school', async () => {
      const { member } = await invitePhoneTeacher();
      await db.insert(schoolMemberTable).values({ schoolId: otherSchool.id, userId: member.userId });
      await expectRpcCode(
        createTestClient(principal).school.issueMemberPassword({ schoolId: school.id, userId: member.userId }),
        'FORBIDDEN',
      );
    });

    it('refuses your own account and callers without the permission', async () => {
      const { member } = await invitePhoneTeacher();
      await expectRpcCode(
        createTestClient(principal).school.issueMemberPassword({ schoolId: school.id, userId: principal.user.id }),
        'BAD_REQUEST',
      );
      await expectRpcCode(
        createTestClient(manager).school.issueMemberPassword({ schoolId: school.id, userId: member.userId }),
        'FORBIDDEN',
      );
    });
  });

  describe('appointing principals', () => {
    it('a manager cannot make themselves principal and then reset the principal', async () => {
      await expectRpcCode(
        createTestClient(manager).school.updateMemberRoles({
          schoolId: school.id,
          userId: manager.user.id,
          roles: [
            { role: 'manager', meta: null },
            { role: 'principal', meta: null },
          ],
        }),
        'FORBIDDEN',
      );
      await expectRpcCode(
        createTestClient(manager).school.issueMemberPassword({
          schoolId: school.id,
          userId: principal.user.id,
        }),
        'FORBIDDEN',
      );
    });

    it('a manager cannot invite a principal, but a principal can', async () => {
      await expectRpcCode(
        createTestClient(manager).school.inviteMember({
          schoolId: school.id,
          email: `${randomUUID()}@school.test`,
          roles: [{ role: 'principal', meta: null }],
        }),
        'FORBIDDEN',
      );
      const invited = await createTestClient(principal).school.inviteMember({
        schoolId: school.id,
        email: `${randomUUID()}@school.test`,
        roles: [{ role: 'principal', meta: null }],
      });
      expect(invited.roles.map(({ role }) => role)).toEqual(['principal']);
    });
  });

  describe('platform user administration', () => {
    it('lists users by phone number with their sign-in details and schools', async () => {
      const { phone, member } = await invitePhoneTeacher();
      const result = await createTestClient(admin).systemAdmin.listUsers({ searchQuery: phone.e164.slice(3) });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        userId: member.userId,
        email: null,
        phoneNumber: phone.e164,
        hasPassword: true,
        hasGoogle: false,
        schools: [{ schoolId: school.id }],
      });
    });

    it('sets a chosen or generated password and signs the user out', async () => {
      const { phone, member, password } = await invitePhoneTeacher();
      const before = await signInWithPhone(phone.e164, password);

      const chosen = await createTestClient(admin).systemAdmin.setUserPassword({
        userId: member.userId,
        password: 'chosen-password-1',
      });
      expect(chosen.password).toBe('chosen-password-1');
      expect(await sessionOf(before.cookie)).toBeNull();
      expect((await signInWithPhone(phone.e164, 'chosen-password-1')).response.status).toBe(200);

      const generated = await createTestClient(admin).systemAdmin.setUserPassword({ userId: member.userId });
      expect(generated.password).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
      expect((await signInWithPhone(phone.e164, generated.password)).response.status).toBe(200);
    });

    it('adds an email that then signs in with the same password', async () => {
      const { phone, member, password } = await invitePhoneTeacher();
      const email = `teacher_${randomUUID().toLowerCase()}@example.com`;

      const updated = await createTestClient(admin).systemAdmin.updateUserSignIn({
        userId: member.userId,
        email: email.toUpperCase(),
        phoneNumber: phone.e164,
      });
      expect(updated).toMatchObject({ email, phoneNumber: phone.e164 });

      const [row] = await db.select().from(user).where(eq(user.id, member.userId));
      expect(row).toMatchObject({ email, emailIsPlaceholder: false, emailVerified: true });
      expect((await signInWithEmail(email, password)).status).toBe(200);
      expect((await signInWithPhone(phone.e164, password)).response.status).toBe(200);

      const member2 = await createTestClient(principal).school.getMember({ schoolId: school.id, userId: member.userId });
      expect(member2.email).toBe(email);

      // A real email can be changed but never removed; the phone can go now.
      await expectRpcCode(
        createTestClient(admin).systemAdmin.updateUserSignIn({ userId: member.userId, email: null, phoneNumber: phone.e164 }),
        'BAD_REQUEST',
      );
      const emailOnly = await createTestClient(admin).systemAdmin.updateUserSignIn({
        userId: member.userId,
        email,
        phoneNumber: null,
      });
      expect(emailOnly.phoneNumber).toBeNull();
      expect((await signInWithPhone(phone.e164, password)).response.status).toBe(401);
    });

    it('refuses an email or phone number another account uses', async () => {
      const first = await invitePhoneTeacher();
      const second = await invitePhoneTeacher();
      await expectRpcCode(
        createTestClient(admin).systemAdmin.updateUserSignIn({
          userId: second.member.userId,
          email: null,
          phoneNumber: first.phone.e164,
        }),
        'CONFLICT',
      );
      await expectRpcCode(
        createTestClient(admin).systemAdmin.updateUserSignIn({
          userId: second.member.userId,
          email: admin.user.email,
          phoneNumber: second.phone.e164,
        }),
        'CONFLICT',
      );
    });

    it('is for platform administrators only', async () => {
      const regular = await createRegularUserSession();
      await expectRpcCode(createTestClient(regular).systemAdmin.listUsers({}), 'FORBIDDEN');
      await expectRpcCode(createTestClient(principal).systemAdmin.setUserPassword({ userId: regular.user.id }), 'FORBIDDEN');
    });
  });
});
