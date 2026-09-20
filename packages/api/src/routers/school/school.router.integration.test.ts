import { db } from "@campuspilot/db";
import { schoolMemberTable } from "@campuspilot/db/schema/school-member";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSchoolMember,
} from "../../../test/fixtures";

describe("school.listMySchools integration", () => {
  it("rejects anonymous callers", async () => {
    await expect(
      createTestClient(null).school.listMySchools(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns only the authenticated user's memberships in deterministic order", async () => {
    const firstSchool = await createTestSchool({ name: "Alpha Academy" });
    const secondSchool = await createTestSchool({ name: "Zeta School" });
    const unrelatedSchool = await createTestSchool({ name: "Middle School" });
    const staff = await createSchoolStaffSession(secondSchool.id, [
      { role: "principal" },
    ]);
    await createTestSchoolMember({
      schoolId: firstSchool.id,
      userId: staff.user.id,
      roles: [{ role: "manager" }],
    });
    await createSchoolStaffSession(unrelatedSchool.id, [{ role: "principal" }]);

    const schools = await createTestClient(staff.session).school.listMySchools();

    expect(schools.map(({ id }) => id)).toEqual([
      firstSchool.id,
      secondSchool.id,
    ]);
  });

  it("returns an empty list for a user without a school membership", async () => {
    const session = await createRegularUserSession();

    await expect(
      createTestClient(session).school.listMySchools(),
    ).resolves.toEqual([]);
  });

  it("stops returning a school after that membership is removed", async () => {
    const school = await createTestSchool();
    const staff = await createSchoolStaffSession(school.id, [
      { role: "principal" },
    ]);

    await db
      .delete(schoolMemberTable)
      .where(
        and(
          eq(schoolMemberTable.schoolId, school.id),
          eq(schoolMemberTable.userId, staff.user.id),
        ),
      );

    await expect(
      createTestClient(staff.session).school.listMySchools(),
    ).resolves.toEqual([]);
  });
});

describe("school details integration", () => {
  it.each(["principal", "manager", "teacher", "accountant", "exam_coordinator"] as const)(
    "allows a school %s to read school details",
    async (role) => {
      const school = await createTestSchool({ registrationNo: "REG-100" });
      const { session } = await createSchoolStaffSession(school.id, [{ role }]);

      const result = await createTestClient(session).school.getSchool({
        schoolId: school.id,
      });

      expect(result).toMatchObject({
        id: school.id,
        name: school.name,
        registrationNo: "REG-100",
      });
    },
  );

  it.each(["principal", "manager"] as const)(
    "allows a school %s to update school details",
    async (role) => {
      const school = await createTestSchool();
      const { session } = await createSchoolStaffSession(school.id, [{ role }]);

      const updated = await createTestClient(session).school.updateSchool({
        schoolId: school.id,
        name: `${school.name} Updated`,
        registrationNo: "REG-200",
      });

      expect(updated.name).toBe(`${school.name} Updated`);
      expect(updated.registrationNo).toBe("REG-200");
    },
  );

  it("denies a teacher from updating school details", async () => {
    const school = await createTestSchool();
    const { session } = await createSchoolStaffSession(school.id, [
      { role: "teacher" },
    ]);

    await expect(
      createTestClient(session).school.updateSchool({
        schoolId: school.id,
        name: "Unauthorized update",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps school detail reads scoped to the requested school", async () => {
    const school = await createTestSchool();
    const otherSchool = await createTestSchool();
    const { session } = await createSchoolStaffSession(otherSchool.id, [
      { role: "principal" },
    ]);

    await expect(
      createTestClient(session).school.getSchool({ schoolId: school.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
