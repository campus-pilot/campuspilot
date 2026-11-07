import { cadetAuth } from "@campuspilot/auth/cadet";
import {
  CADET_OAUTH_GRANT_TABLES,
  findLiveOAuthGrant,
} from "@campuspilot/auth/mcp-credential";
import { db } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import {
  cadetAccount,
  cadetOauthConsent,
  cadetSession,
  cadetUser,
} from "@campuspilot/db/schema/cadet";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { connectCadetMcp, signInCadet } from "../../../../test/cadet";
import { expectRpcCode } from "../../../../test/finance/assertions";
import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestClient,
  createTestSchool,
  createTestStudent,
  createTestSession,
} from "../../../../test/fixtures";

function admissionInput(schoolId: string, admissionNo: string) {
  return {
    schoolId,
    name: `Student ${admissionNo}`,
    admissionNo,
    address: "Test address",
    phoneNo: "9999999999",
    dob: "2016-01-01",
    fatherName: "Test Father",
    motherName: "Test Mother",
  };
}

async function setup() {
  const school = await createTestSchool();
  const otherSchool = await createTestSchool();
  const [principal, manager, teacher, accountant, outsider] = await Promise.all([
    createSchoolStaffSession(school.id, [{ role: "principal", meta: null }]),
    createSchoolStaffSession(school.id, [{ role: "manager", meta: null }]),
    createSchoolStaffSession(school.id, [{ role: "teacher", meta: { classIds: [] } }]),
    createSchoolStaffSession(school.id, [{ role: "accountant", meta: null }]),
    createSchoolStaffSession(otherSchool.id, [{ role: "principal", meta: null }]),
  ]);
  return {
    school,
    principal: { ...principal, client: createTestClient(principal.session) },
    manager: { ...manager, client: createTestClient(manager.session) },
    teacher: createTestClient(teacher.session),
    accountant: createTestClient(accountant.session),
    outsider: createTestClient(outsider.session),
  };
}

async function sessionOf(cookie: string) {
  return cadetAuth.api.getSession({ headers: new Headers({ cookie }) });
}

async function loginRows(admissionId: string) {
  return db.select().from(cadetUser).where(eq(cadetUser.admissionId, admissionId));
}

describe("createAdmission with generateCadetPassword", () => {
  it("creates no cadet login by default or when false", async () => {
    const { school, principal } = await setup();
    const omitted = await principal.client.school.createAdmission(admissionInput(school.id, "CP-OMIT"));
    const explicit = await principal.client.school.createAdmission({
      ...admissionInput(school.id, "CP-FALSE"),
      generateCadetPassword: false,
    });
    expect(omitted.cadetPassword).toBeNull();
    expect(explicit.cadetPassword).toBeNull();
    expect(await loginRows(omitted.id)).toEqual([]);
    expect(await loginRows(explicit.id)).toEqual([]);
  });

  it("creates the admission and its login together and returns the password once", async () => {
    const { school, manager } = await setup();
    const created = await manager.client.school.createAdmission({
      ...admissionInput(school.id, "CP-TRUE"),
      generateCadetPassword: true,
    });
    expect(created.cadetPassword).toEqual({
      schoolSlug: school.slug,
      admissionNo: "CP-TRUE",
      password: expect.stringMatching(/^[a-z]+-[a-z]+-[1-9]\d$/),
    });

    const [login] = await loginRows(created.id);
    expect(login).toMatchObject({ passwordSource: "issued", issuedBy: manager.user.id });
    const [account] = await db.select().from(cadetAccount).where(eq(cadetAccount.userId, login!.id));
    // Only the hash is stored.
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain(created.cadetPassword!.password);

    const { response } = await signInCadet(created.cadetPassword!);
    expect(response.status).toBe(200);
  });

  it("rolls the login back with the admission when creation fails", async () => {
    const { school, principal } = await setup();
    await principal.client.school.createAdmission(admissionInput(school.id, "CP-DUP"));
    await expect(
      principal.client.school.createAdmission({
        ...admissionInput(school.id, "CP-DUP"),
        generateCadetPassword: true,
      }),
    ).rejects.toThrow();
    const logins = await db
      .select({ id: cadetUser.id })
      .from(cadetUser)
      .innerJoin(admissionTable, eq(admissionTable.id, cadetUser.admissionId))
      .where(eq(admissionTable.schoolId, school.id));
    expect(logins).toEqual([]);
  });

  it("rejects a non-boolean flag and callers without both permissions", async () => {
    const { school, principal, teacher, accountant } = await setup();
    await expectRpcCode(
      principal.client.school.createAdmission({
        ...admissionInput(school.id, "CP-BAD"),
        generateCadetPassword: "yes" as unknown as boolean,
      }),
      "BAD_REQUEST",
    );
    for (const client of [teacher, accountant]) {
      await expectRpcCode(
        client.school.createAdmission({ ...admissionInput(school.id, "CP-ROLE"), generateCadetPassword: true }),
        "FORBIDDEN",
      );
    }
  });
});

describe("issueAdmissionCadetPassword", () => {
  it("enforces authentication, the issue permission and the school scope", async () => {
    const { school, teacher, accountant, outsider } = await setup();
    const admission = await createTestAdmission({ schoolId: school.id });
    const input = { schoolId: school.id, admissionId: admission.id };
    await expectRpcCode(createTestClient(null).school.issueAdmissionCadetPassword(input), "UNAUTHORIZED");
    await expectRpcCode(teacher.school.issueAdmissionCadetPassword(input), "FORBIDDEN");
    await expectRpcCode(accountant.school.issueAdmissionCadetPassword(input), "FORBIDDEN");
    await expectRpcCode(outsider.school.issueAdmissionCadetPassword(input), "FORBIDDEN");
    expect(await loginRows(admission.id)).toEqual([]);
  });

  it("validates input and refuses unknown admissions", async () => {
    const { school, principal } = await setup();
    await expectRpcCode(
      principal.client.school.issueAdmissionCadetPassword({ schoolId: school.id, admissionId: "" }),
      "BAD_REQUEST",
    );
    await expectRpcCode(
      principal.client.school.issueAdmissionCadetPassword({ schoolId: school.id, admissionId: "adm_missing" }),
      "NOT_FOUND",
    );
    // An admission of another school is not found through this school.
    const elsewhere = await createTestAdmission({ schoolId: (await createTestSchool()).id });
    await expectRpcCode(
      principal.client.school.issueAdmissionCadetPassword({ schoolId: school.id, admissionId: elsewhere.id }),
      "NOT_FOUND",
    );
  });

  it("issues a first password, then a reset replaces it and signs the student out everywhere", async () => {
    const { school, principal, manager } = await setup();
    const admission = await createTestAdmission({ schoolId: school.id });
    const input = { schoolId: school.id, admissionId: admission.id };

    const first = await principal.client.school.issueAdmissionCadetPassword(input);
    expect(first).toMatchObject({ schoolSlug: school.slug, admissionNo: admission.admissionNo });
    const [firstLogin] = await loginRows(admission.id);
    const browser = await signInCadet(first);
    const mcp = await connectCadetMcp(first);
    expect(await sessionOf(browser.cookie)).not.toBeNull();
    expect(await findLiveOAuthGrant(db, mcp.claims, CADET_OAUTH_GRANT_TABLES)).not.toBeNull();

    const second = await manager.client.school.issueAdmissionCadetPassword(input);
    expect(second.password).not.toBe(first.password);
    const [secondLogin] = await loginRows(admission.id);
    // The same login is kept; only the password and issue facts change.
    expect(secondLogin!.id).toBe(firstLogin!.id);
    expect(secondLogin).toMatchObject({ passwordSource: "issued", issuedBy: manager.user.id });
    expect(secondLogin!.issuedAt.getTime()).toBeGreaterThanOrEqual(firstLogin!.issuedAt.getTime());

    // Old sessions (database and Redis) and AI app grants are gone.
    expect(await sessionOf(browser.cookie)).toBeNull();
    expect(await sessionOf(mcp.sessionCookie)).toBeNull();
    expect(await db.select().from(cadetSession).where(eq(cadetSession.userId, firstLogin!.id))).toEqual([]);
    expect(await db.select().from(cadetOauthConsent).where(eq(cadetOauthConsent.userId, firstLogin!.id))).toEqual([]);
    expect(await findLiveOAuthGrant(db, mcp.claims, CADET_OAUTH_GRANT_TABLES)).toBeNull();

    expect((await signInCadet(first)).response.status).toBe(401);
    expect((await signInCadet(second)).response.status).toBe(200);
  });
});

describe("admission lifecycle and Cadet Portal access", () => {
  it("keeps portal access when the admission is unregistered", async () => {
    const { school, principal } = await setup();
    const created = await principal.client.school.createAdmission({
      ...admissionInput(school.id, "CP-UNREG"),
      generateCadetPassword: true,
    });
    const browser = await signInCadet(created.cadetPassword!);

    await principal.client.school.unregisterAdmission({
      schoolId: school.id,
      admissionId: created.id,
      confirmationName: created.name,
    });

    expect(await sessionOf(browser.cookie)).not.toBeNull();
    expect((await signInCadet(created.cadetPassword!)).response.status).toBe(200);
  });

  it("lets staff issue and reset a password for an unregistered admission", async () => {
    const { school, principal } = await setup();
    const unregistered = await createTestAdmission({ schoolId: school.id, registered: false });
    const input = { schoolId: school.id, admissionId: unregistered.id };
    const first = await principal.client.school.issueAdmissionCadetPassword(input);
    expect((await signInCadet(first)).response.status).toBe(200);
    const second = await principal.client.school.issueAdmissionCadetPassword(input);
    expect((await signInCadet(first)).response.status).toBe(401);
    expect((await signInCadet(second)).response.status).toBe(200);
    // The admission itself is untouched.
    const [row] = await db.select().from(admissionTable).where(eq(admissionTable.id, unregistered.id));
    expect(row?.registered).toBe(false);
  });

  it("signs the student out and removes the login when the admission is deleted", async () => {
    const { school, principal } = await setup();
    const created = await principal.client.school.createAdmission({
      ...admissionInput(school.id, "CP-DEL"),
      generateCadetPassword: true,
    });
    const [login] = await loginRows(created.id);
    const browser = await signInCadet(created.cadetPassword!);
    const mcp = await connectCadetMcp(created.cadetPassword!);

    await principal.client.school.deleteAdmission({ schoolId: school.id, admissionId: created.id });

    expect(await sessionOf(browser.cookie)).toBeNull();
    expect(await findLiveOAuthGrant(db, mcp.claims, CADET_OAUTH_GRANT_TABLES)).toBeNull();
    expect(await loginRows(created.id)).toEqual([]);
    expect(await db.select().from(cadetAccount).where(eq(cadetAccount.userId, login!.id))).toEqual([]);
  });

  it("keeps the login when a delete is refused", async () => {
    const { school, principal } = await setup();
    const created = await principal.client.school.createAdmission({
      ...admissionInput(school.id, "CP-KEEP"),
      generateCadetPassword: true,
    });
    const session = await createTestSession({ schoolId: school.id, sessionStartYear: 2040, sessionEndYear: 2041 });
    await createTestStudent({ schoolId: school.id, admissionId: created.id, sessionId: session.id });
    const browser = await signInCadet(created.cadetPassword!);

    await expectRpcCode(
      principal.client.school.deleteAdmission({ schoolId: school.id, admissionId: created.id }),
      "CONFLICT",
    );
    expect(await loginRows(created.id)).toHaveLength(1);
    expect(await sessionOf(browser.cookie)).not.toBeNull();
  });
});
