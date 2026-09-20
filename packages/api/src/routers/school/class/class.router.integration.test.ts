import { db } from "@campuspilot/db";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClass,
  createTestClient,
  createTestSchool,
  type UserSession,
} from "../../../../test/fixtures";

describe("school class and section router integration", () => {
  let school: Awaited<ReturnType<typeof createTestSchool>>;
  let principalSession: UserSession;
  let managerSession: UserSession;
  let teacherSession: UserSession;
  let regularSession: UserSession;
  let adminSession: UserSession;

  beforeAll(async () => {
    school = await createTestSchool();
    principalSession = (
      await createSchoolStaffSession(school.id, [
        { role: "principal", meta: null },
      ])
    ).session;
    managerSession = (
      await createSchoolStaffSession(school.id, [
        { role: "manager", meta: null },
      ])
    ).session;
    teacherSession = (
      await createSchoolStaffSession(school.id, [
        { role: "teacher", meta: { classIds: [] } },
      ])
    ).session;
    regularSession = await createRegularUserSession();
    adminSession = await createAdminSession();
  });

  describe("createClass", () => {
    it("creates a class and its required initial sections atomically with JSON defaults", async () => {
      const client = createTestClient(principalSession);

      const schoolClass = await client.school.createClass({
        schoolId: school.id,
        slug: "grade-one",
        label: "Grade One",
        sections: [
          { slug: "a", label: "Section A" },
          { slug: "b", label: "Section B" },
        ],
      });

      expect(schoolClass).toMatchObject({
        schoolId: school.id,
        slug: "grade-one",
        label: "Grade One",
        attributes: {},
        config: { subjects: {} },
      });
      const sections = await db
        .select()
        .from(sectionTable)
        .where(eq(sectionTable.classId, schoolClass.id));
      expect(sections).toHaveLength(2);
      expect(sections.every((section) => section.schoolId === school.id)).toBe(
        true,
      );
    });

    it("allows managers to create classes", async () => {
      const schoolClass = await createTestClient(managerSession).school.createClass({
        schoolId: school.id,
        slug: "grade-two",
        label: "Grade Two",
        sections: [{ slug: "a", label: "Section A" }],
      });

      expect(schoolClass.slug).toBe("grade-two");
    });

    it("rejects missing sections and invalid slugs before persistence", async () => {
      const client = createTestClient(principalSession);

      await expect(
        client.school.createClass({
          schoolId: school.id,
          slug: "grade-three",
          label: "Grade Three",
          sections: [],
        }),
      ).rejects.toThrow();
      await expect(
        client.school.createClass({
          schoolId: school.id,
          slug: "Grade Three",
          label: "Grade Three",
          sections: [{ slug: "a", label: "Section A" }],
        }),
      ).rejects.toThrow();
    });

    it("rolls back the class when initial section slugs conflict", async () => {
      const client = createTestClient(principalSession);

      await expect(
        client.school.createClass({
          schoolId: school.id,
          slug: "rollback-class",
          label: "Rollback Class",
          sections: [
            { slug: "a", label: "Section A" },
            { slug: "a", label: "Another Section A" },
          ],
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: "CONFLICT" }));

      const rows = await db
        .select({ id: classTable.id })
        .from(classTable)
        .where(
          and(
            eq(classTable.schoolId, school.id),
            eq(classTable.slug, "rollback-class"),
          ),
        );
      expect(rows).toHaveLength(0);
    });

    it("reports duplicate class slugs within a school as CONFLICT", async () => {
      const client = createTestClient(principalSession);
      const input = {
        schoolId: school.id,
        slug: "duplicate-class",
        label: "Duplicate Class",
        sections: [{ slug: "a", label: "Section A" }],
      };

      await client.school.createClass(input);
      await expect(client.school.createClass(input)).rejects.toThrowError(
        expect.objectContaining({ code: "CONFLICT" }),
      );
    });

    it("denies unauthenticated callers, teachers, regular users, and platform admins", async () => {
      const input = {
        schoolId: school.id,
        slug: "denied-class",
        label: "Denied Class",
        sections: [{ slug: "a", label: "Section A" }],
      };

      await expect(
        createTestClient(null).school.createClass(input),
      ).rejects.toThrowError(expect.objectContaining({ code: "UNAUTHORIZED" }));
      for (const session of [teacherSession, regularSession, adminSession]) {
        await expect(
          createTestClient(session).school.createClass(input),
        ).rejects.toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
      }
    });

    it("denies a manager whose role belongs to another school", async () => {
      const otherSchool = await createTestSchool();

      await expect(
        createTestClient(managerSession).school.createClass({
          schoolId: otherSchool.id,
          slug: "wrong-scope",
          label: "Wrong Scope",
          sections: [{ slug: "a", label: "Section A" }],
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
    });
  });

  describe("class reads and updates", () => {
    it("allows any school role to list, search, and read classes", async () => {
      const testSchool = await createTestSchool();
      const teacher = await createSchoolStaffSession(testSchool.id, [
        { role: "teacher", meta: { classIds: [] } },
      ]);
      const { schoolClass } = await createTestClass({
        schoolId: testSchool.id,
        slug: "searched-class",
        label: "Searched Class",
      });
      const client = createTestClient(teacher.session);

      const classes = await client.school.listClasses({
        schoolId: testSchool.id,
        searchQuery: "searched",
      });
      const fetched = await client.school.getClass({
        schoolId: testSchool.id,
        classId: schoolClass.id,
      });

      expect(classes.items.map((item) => item.id)).toContain(schoolClass.id);
      expect(classes.pagination.totalItems).toBe(1);
      expect(fetched.id).toBe(schoolClass.id);
    });

    it("allows a principal to rename a class and denies a teacher", async () => {
      const { schoolClass } = await createTestClass({
        schoolId: school.id,
        slug: "rename-class",
      });

      const updated = await createTestClient(principalSession).school.updateClass({
        schoolId: school.id,
        classId: schoolClass.id,
        slug: "renamed-class",
        label: "Renamed Class",
      });
      expect(updated.slug).toBe("renamed-class");

      await expect(
        createTestClient(teacherSession).school.updateClass({
          schoolId: school.id,
          classId: schoolClass.id,
          label: "Teacher Rename",
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
    });

    it("allows a teacher to replace class attributes and configuration", async () => {
      const { schoolClass } = await createTestClass({
        schoolId: school.id,
        slug: "configured-class",
      });

      const updated = await createTestClient(
        teacherSession,
      ).school.updateClassConfiguration({
        schoolId: school.id,
        classId: schoolClass.id,
        attributes: { room: "201" },
        config: {
          subjects: {
            math: {
              name: "Mathematics",
              books: [{ title: "Numbers" }],
              examModes: {
                written: { name: "Written", percentage: 100 },
              },
            },
          },
        },
      });

      expect(updated.attributes).toEqual({ room: "201" });
      expect(updated.config.subjects.math?.books).toEqual([
        { title: "Numbers" },
      ]);
    });

    it("returns NOT_FOUND for a class outside the supplied school", async () => {
      const otherSchool = await createTestSchool();
      const { schoolClass } = await createTestClass({ schoolId: otherSchool.id });

      await expect(
        createTestClient(principalSession).school.getClass({
          schoolId: school.id,
          classId: schoolClass.id,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
    });
  });

  describe("section CRUD", () => {
    it("allows principals to create, list, read, and rename sections", async () => {
      const { schoolClass } = await createTestClass({
        schoolId: school.id,
        slug: "section-crud-class",
      });
      const client = createTestClient(principalSession);

      const created = await client.school.createSection({
        schoolId: school.id,
        classId: schoolClass.id,
        slug: "b",
        label: "Section B",
      });
      const listed = await client.school.listSections({
        schoolId: school.id,
        classId: schoolClass.id,
      });
      const fetched = await client.school.getSection({
        schoolId: school.id,
        classId: schoolClass.id,
        sectionId: created.id,
      });
      const updated = await client.school.updateSection({
        schoolId: school.id,
        classId: schoolClass.id,
        sectionId: created.id,
        slug: "beta",
        label: "Section Beta",
      });

      expect(listed.items).toHaveLength(2);
      expect(fetched.id).toBe(created.id);
      expect(updated).toMatchObject({ slug: "beta", label: "Section Beta" });
    });

    it("allows teachers to update attributes but not structural fields or create sections", async () => {
      const { schoolClass, sections } = await createTestClass({
        schoolId: school.id,
        slug: "teacher-section-class",
      });
      const client = createTestClient(teacherSession);

      const updated = await client.school.updateSectionAttributes({
        schoolId: school.id,
        classId: schoolClass.id,
        sectionId: sections[0]!.id,
        attributes: { floor: 2 },
      });
      expect(updated.attributes).toEqual({ floor: 2 });

      await expect(
        client.school.updateSection({
          schoolId: school.id,
          classId: schoolClass.id,
          sectionId: sections[0]!.id,
          label: "Not Allowed",
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
      await expect(
        client.school.createSection({
          schoolId: school.id,
          classId: schoolClass.id,
          slug: "b",
          label: "Section B",
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
    });

    it("prevents deleting a class's only section", async () => {
      const { schoolClass, sections } = await createTestClass({
        schoolId: school.id,
        slug: "single-section-class",
      });

      await expect(
        createTestClient(managerSession).school.deleteSection({
          schoolId: school.id,
          classId: schoolClass.id,
          sectionId: sections[0]!.id,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
    });

    it("deletes one of multiple sections and reports duplicate slugs as CONFLICT", async () => {
      const { schoolClass, sections } = await createTestClass({
        schoolId: school.id,
        slug: "multi-section-class",
        sections: [
          { slug: "a", label: "Section A" },
          { slug: "b", label: "Section B" },
        ],
      });
      const client = createTestClient(managerSession);

      await expect(
        client.school.createSection({
          schoolId: school.id,
          classId: schoolClass.id,
          slug: "b",
          label: "Duplicate B",
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: "CONFLICT" }));

      const deleted = await client.school.deleteSection({
        schoolId: school.id,
        classId: schoolClass.id,
        sectionId: sections[1]!.id,
      });
      expect(deleted.id).toBe(sections[1]!.id);
    });

    it("validates class parentage independently from the supplied school", async () => {
      const otherSchool = await createTestSchool();
      const { schoolClass } = await createTestClass({ schoolId: otherSchool.id });

      await expect(
        createTestClient(principalSession).school.createSection({
          schoolId: school.id,
          classId: schoolClass.id,
          slug: "b",
          label: "Section B",
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
    });
  });

  describe("deleteClass", () => {
    it("deletes a class and all of its sections transactionally", async () => {
      const { schoolClass } = await createTestClass({
        schoolId: school.id,
        slug: "delete-class",
        sections: [
          { slug: "a", label: "Section A" },
          { slug: "b", label: "Section B" },
        ],
      });

      const deleted = await createTestClient(managerSession).school.deleteClass({
        schoolId: school.id,
        classId: schoolClass.id,
      });
      expect(deleted.id).toBe(schoolClass.id);

      const sections = await db
        .select({ id: sectionTable.id })
        .from(sectionTable)
        .where(eq(sectionTable.classId, schoolClass.id));
      expect(sections).toHaveLength(0);
    });
  });
});
