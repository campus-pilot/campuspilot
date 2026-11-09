import { db } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createAdminSession,
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
} from "../../../../test/fixtures";

function admissionInput(schoolId: string, admissionNo: string) {
  return {
    schoolId,
    name: `Student ${admissionNo}`,
    admissionNo,
    address: "Test address",
    phoneNo: "9999999999",
    whatsappSameAsPhone: true,
    email: `${admissionNo.toLowerCase()}@example.com`,
    dob: "2015-01-01",
    fatherName: "Test Father",
    motherName: "Test Mother",
  };
}

describe("school admission and student router integration", () => {
  it("governs advisory admission settings without constraining admission creation", async () => {
    const school = await createTestSchool();
    const principal = await createSchoolStaffSession(school.id, [
      { role: "principal", meta: null },
    ]);
    const teacher = await createSchoolStaffSession(school.id, [
      { role: "teacher", meta: { classIds: [] } },
    ]);
    const admin = await createAdminSession();
    const adminClient = createTestClient(admin);

    const settings = await adminClient.school.updateAdmissionSettings({
      schoolId: school.id,
      settings: {
        documentTypes: [
          { value: "birth-certificate", label: "Birth certificate" },
          { value: "address-proof", label: "Address proof" },
        ],
      },
    });
    expect(settings.settings.documentTypes).toHaveLength(2);

    await expect(
      createTestClient(teacher.session).school.getAdmissionSettings({
        schoolId: school.id,
      }),
    ).resolves.toEqual(settings);
    await expect(
      createTestClient(teacher.session).school.updateAdmissionSettings({
        schoolId: school.id,
        settings: { documentTypes: [] },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
    await expect(
      adminClient.school.updateAdmissionSettings({
        schoolId: school.id,
        settings: {
          documentTypes: Array.from({ length: 11 }, (_, index) => ({
            value: `document-${index}`,
            label: `Document ${index}`,
          })),
        },
      }),
    ).rejects.toThrow();

    const admission = await createTestClient(
      principal.session,
    ).school.createAdmission(admissionInput(school.id, "ADV-1"));
    expect(admission.documents).toEqual([]);
  });

  it("allows every current school role to read admissions but only principal and manager to mutate them", async () => {
    const school = await createTestSchool();
    const principal = await createSchoolStaffSession(school.id, [
      { role: "principal", meta: null },
    ]);
    const manager = await createSchoolStaffSession(school.id, [
      { role: "manager", meta: null },
    ]);
    const readers = await Promise.all(
      (["teacher", "accountant", "exam_coordinator"] as const).map((role) =>
        createSchoolStaffSession(school.id, [
          {
            role,
            meta: role === "teacher" ? { classIds: [] } : null,
          },
        ]),
      ),
    );
    const created = await createTestClient(
      principal.session,
    ).school.createAdmission(admissionInput(school.id, "READ-1"));

    for (const reader of readers) {
      const client = createTestClient(reader.session);
      await expect(
        client.school.getAdmission({
          schoolId: school.id,
          admissionId: created.id,
        }),
      ).resolves.toMatchObject({ id: created.id });
      await expect(
        client.school.listAdmissions({ schoolId: school.id }),
      ).resolves.toMatchObject({ pagination: { totalItems: 1 } });
    }

    const updated = await createTestClient(
      manager.session,
    ).school.updateAdmission({
      schoolId: school.id,
      admissionId: created.id,
      address: "Updated address",
    });
    expect(updated.address).toBe("Updated address");

    await expect(
      createTestClient(readers[0]!.session).school.createAdmission(
        admissionInput(school.id, "DENIED-1"),
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
    await expect(
      createTestClient(await createAdminSession()).school.createAdmission(
        admissionInput(school.id, "ADMIN-DENIED-1"),
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));

    const deleted = await createTestClient(
      manager.session,
    ).school.deleteAdmission({
      schoolId: school.id,
      admissionId: created.id,
    });
    expect(deleted.id).toBe(created.id);
  });

  it("paginates admissions and filters admissions not enrolled in an explicit session", async () => {
    const school = await createTestSchool();
    const teacher = await createSchoolStaffSession(school.id, [
      { role: "teacher", meta: { classIds: [] } },
    ]);
    const session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2030,
      sessionEndYear: 2031,
    });
    const enrolled = await createTestAdmission({
      schoolId: school.id,
      name: "Enrolled Student",
    });
    const waiting = await createTestAdmission({
      schoolId: school.id,
      name: "Waiting Student",
    });
    const { schoolClass, sections } = await createTestClass({
      schoolId: school.id,
    });
    await createTestStudent({
      schoolId: school.id,
      admissionId: enrolled.id,
      sessionId: session.id,
      classId: schoolClass.id,
      sectionId: sections[0]!.id,
      rollNo: 1,
    });

    const client = createTestClient(teacher.session);
    const firstPage = await client.school.listAdmissions({
      schoolId: school.id,
      limit: 1,
      orderBy: { field: "name", direction: "asc" },
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.pagination).toMatchObject({
      currentPage: 1,
      totalItems: 2,
      totalPages: 2,
      nextCursor: "2",
    });

    const unadmitted = await client.school.listAdmissions({
      schoolId: school.id,
      filters: { unadmittedForSessionId: session.id },
    });
    expect(unadmitted.items.map(({ id }) => id)).toEqual([waiting.id]);

    const unassigned = await client.school.listAdmissions({
      schoolId: school.id,
      filters: {
        placementSessionId: session.id,
        placementStatus: "unassigned",
      },
    });
    expect(unassigned.items.map(({ id }) => id)).toEqual([waiting.id]);

    const assigned = await client.school.listAdmissions({
      schoolId: school.id,
      filters: {
        placementSessionId: session.id,
        placementStatus: "assigned",
      },
    });
    expect(assigned.items).toMatchObject([
      {
        id: enrolled.id,
        placement: {
          classId: schoolClass.id,
          sectionId: sections[0]!.id,
          rollNo: 1,
        },
      },
    ]);

    const { schoolClass: otherClass } = await createTestClass({
      schoolId: school.id,
    });
    const inClass = await client.school.listAdmissions({
      schoolId: school.id,
      filters: {
        placementSessionId: session.id,
        placementClassId: schoolClass.id,
      },
    });
    expect(inClass.items.map(({ id }) => id)).toEqual([enrolled.id]);
    expect(inClass.pagination.totalItems).toBe(1);

    const inOtherClass = await client.school.listAdmissions({
      schoolId: school.id,
      filters: {
        placementSessionId: session.id,
        placementClassId: otherClass.id,
      },
    });
    expect(inOtherClass.items).toEqual([]);

    await expect(
      client.school.listAdmissions({
        schoolId: school.id,
        filters: { placementClassId: schoolClass.id },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("fuzzy-searches registered admissions and applies stable relevance ranking", async () => {
    const school = await createTestSchool();
    const teacher = await createSchoolStaffSession(school.id, [
      { role: "teacher", meta: { classIds: [] } },
    ]);
    const exactFirst = await createTestAdmission({
      id: "fuzzy-rank-a",
      schoolId: school.id,
      name: "Clara",
      admissionNo: "RANK-1",
    });
    const exactSecond = await createTestAdmission({
      id: "fuzzy-rank-b",
      schoolId: school.id,
      name: "Clara",
      admissionNo: "RANK-2",
    });
    const prefix = await createTestAdmission({
      schoolId: school.id,
      name: "Clara Barton",
      admissionNo: "RANK-3",
    });
    const substring = await createTestAdmission({
      schoolId: school.id,
      name: "A Clara Student",
      admissionNo: "RANK-4",
    });
    const typo = await createTestAdmission({
      schoolId: school.id,
      name: "Clora Candidate",
      admissionNo: "RANK-5",
    });
    const inactive = await createTestAdmission({
      schoolId: school.id,
      name: "Clara Inactive",
      admissionNo: "RANK-6",
      registered: false,
    });
    const admissionNumberTypo = await createTestAdmission({
      schoolId: school.id,
      name: "Unrelated Name",
      admissionNo: "ACD-2043",
    });

    const client = createTestClient(teacher.session);
    await expect(
      client.school.listAdmissions({
        schoolId: school.id,
        searchQuery: "Clara",
        searchMode: "fuzzy",
        filters: { registered: true },
        orderBy: { field: "relevance", direction: "asc" },
      }),
    ).rejects.toThrow("Input validation failed");

    const matches = await client.school.listAdmissions({
      schoolId: school.id,
      searchQuery: "Clara",
      searchMode: "fuzzy",
      filters: { registered: true },
      orderBy: { field: "relevance", direction: "desc" },
    });

    expect(matches.items.map(({ id }) => id)).toEqual([
      exactFirst.id,
      exactSecond.id,
      prefix.id,
      substring.id,
      typo.id,
    ]);
    expect(matches.items[0]).not.toHaveProperty("relevance");

    const inactiveMatches = await client.school.listAdmissions({
      schoolId: school.id,
      searchQuery: "Clara",
      searchMode: "fuzzy",
      filters: { registered: false },
      orderBy: { field: "relevance", direction: "desc" },
    });
    expect(inactiveMatches.items.map(({ id }) => id)).toEqual([inactive.id]);

    const admissionNumberMatches = await client.school.listAdmissions({
      schoolId: school.id,
      searchQuery: "ACD-2042",
      searchMode: "fuzzy",
      orderBy: { field: "relevance", direction: "desc" },
    });
    expect(admissionNumberMatches.items.map(({ id }) => id)).toEqual([
      admissionNumberTypo.id,
    ]);
  });

  it("treats LIKE metacharacters literally in fuzzy admission search", async () => {
    const school = await createTestSchool();
    const teacher = await createSchoolStaffSession(school.id, [
      { role: "teacher", meta: { classIds: [] } },
    ]);
    const percent = await createTestAdmission({
      schoolId: school.id,
      name: "Percent % Student",
      admissionNo: "LITERAL-1",
    });
    const underscore = await createTestAdmission({
      schoolId: school.id,
      name: "Under_score Student",
      admissionNo: "LITERAL-2",
    });
    const backslash = await createTestAdmission({
      schoolId: school.id,
      name: "Back\\slash Student",
      admissionNo: "LITERAL-3",
    });
    await createTestAdmission({
      schoolId: school.id,
      name: "Ordinary Student",
      admissionNo: "LITERAL-4",
    });

    const client = createTestClient(teacher.session);
    for (const [searchQuery, expectedId] of [
      ["%", percent.id],
      ["_", underscore.id],
      ["\\", backslash.id],
    ] as const) {
      const result = await client.school.listAdmissions({
        schoolId: school.id,
        searchQuery,
        searchMode: "fuzzy",
        orderBy: { field: "relevance", direction: "desc" },
      });
      expect(result.items.map(({ id }) => id)).toEqual([expectedId]);
    }
  });

  it("preserves default contains search across non-name admission fields", async () => {
    const school = await createTestSchool();
    const teacher = await createSchoolStaffSession(school.id, [
      { role: "teacher", meta: { classIds: [] } },
    ]);
    // A fixed admission number: the fixture's random UUID default can share
    // enough digit trigrams with the phone query to pass the fuzzy threshold.
    const admission = await createTestAdmission({
      schoolId: school.id,
      admissionNo: "ADM-LOOKUP",
    });
    await db
      .update(admissionTable)
      .set({ phoneNo: "88005551234", email: "lookup@example.com" })
      .where(eq(admissionTable.id, admission.id));
    const client = createTestClient(teacher.session);

    await expect(
      client.school.listAdmissions({
        schoolId: school.id,
        searchQuery: "5551234",
      }),
    ).resolves.toMatchObject({ items: [{ id: admission.id }] });
    await expect(
      client.school.listAdmissions({
        schoolId: school.id,
        searchQuery: "lookup@example",
      }),
    ).resolves.toMatchObject({ items: [{ id: admission.id }] });
    await expect(
      client.school.listAdmissions({
        schoolId: school.id,
        searchQuery: "5551234",
        searchMode: "fuzzy",
      }),
    ).resolves.toMatchObject({ items: [] });
  });

  it("finds an E.164 phone however staff type it", async () => {
    const school = await createTestSchool();
    const teacher = await createSchoolStaffSession(school.id, [
      { role: "teacher", meta: { classIds: [] } },
    ]);
    const admission = await createTestAdmission({
      schoolId: school.id,
      admissionNo: "ADM-PHONE",
    });
    await db
      .update(admissionTable)
      .set({ phoneNo: "+919876543210" })
      .where(eq(admissionTable.id, admission.id));
    const client = createTestClient(teacher.session);
    for (const searchQuery of ["98765 43210", "098765 43210", "+91 98765 43210", "9876543210", "43210"]) {
      await expect(
        client.school.listAdmissions({ schoolId: school.id, searchQuery }),
        searchQuery,
      ).resolves.toMatchObject({ items: [{ id: admission.id }] });
    }
    await expect(
      client.school.listAdmissions({ schoolId: school.id, searchQuery: "98765 00000" }),
    ).resolves.toMatchObject({ items: [] });
  });

  it("keeps restricted finance values out of general admission DTOs", async () => {
    const school = await createTestSchool();
    const teacher = await createSchoolStaffSession(school.id, [
      { role: "teacher", meta: { classIds: [] } },
    ]);
    const session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2032,
      sessionEndYear: 2033,
    });
    const admission = await createTestAdmission({ schoolId: school.id });
    await db
      .update(admissionTable)
      .set({
        financeValue: { [session.id]: { transport: 500 } },
      })
      .where(eq(admissionTable.id, admission.id));
    const client = createTestClient(teacher.session);

    const [fetched, listed] = await Promise.all([
      client.school.getAdmission({
        schoolId: school.id,
        admissionId: admission.id,
      }),
      client.school.listAdmissions({ schoolId: school.id }),
    ]);
    expect(fetched).not.toHaveProperty("financeValue");
    expect(listed.items[0]).not.toHaveProperty("financeValue");

    const principal = await createSchoolStaffSession(school.id, [
      { role: "principal", meta: null },
    ]);
    const unsafeChanges = {
      schoolId: school.id,
      admissionId: admission.id,
      address: "Updated without touching pricing",
      financeValue: { [session.id]: { transport: 999 } },
    };
    await expect(
      createTestClient(principal.session).school.updateAdmission(
        unsafeChanges as never,
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));

    const [stored] = await db
      .select({
        address: admissionTable.address,
        financeValue: admissionTable.financeValue,
      })
      .from(admissionTable)
      .where(eq(admissionTable.id, admission.id));
    expect(stored?.address).toBe(admission.address);
    expect(stored?.financeValue).toEqual({
      [session.id]: { transport: 500 },
    });
  });

  it("enrolls students in explicit sessions for managers or assigned teachers and supports detachment", async () => {
    const school = await createTestSchool();
    const session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2034,
      sessionEndYear: 2035,
      isActive: false,
    });
    const { schoolClass, sections } = await createTestClass({
      schoolId: school.id,
      sections: [
        { slug: "a", label: "Section A" },
        { slug: "b", label: "Section B" },
      ],
    });
    const manager = await createSchoolStaffSession(school.id, [
      { role: "manager", meta: null },
    ]);
    const teacher = await createSchoolStaffSession(school.id, [
      { role: "teacher", meta: { classIds: [schoolClass.id] } },
    ]);
    const unassignedTeacher = await createSchoolStaffSession(school.id, [
      { role: "teacher", meta: { classIds: [] } },
    ]);
    const firstAdmission = await createTestAdmission({ schoolId: school.id });
    const secondAdmission = await createTestAdmission({ schoolId: school.id });

    const first = await createTestClient(manager.session).school.createStudent({
      schoolId: school.id,
      sessionId: session.id,
      admissionId: firstAdmission.id,
      sectionId: sections[0]!.id,
      rollNo: 1,
    });
    const second = await createTestClient(teacher.session).school.createStudent({
      schoolId: school.id,
      sessionId: session.id,
      admissionId: secondAdmission.id,
      sectionId: sections[0]!.id,
      rollNo: 2,
    });
    expect(first.sessionId).toBe(session.id);
    expect(second.classId).toBe(schoolClass.id);

    await expect(
      createTestClient(unassignedTeacher.session).school.createStudent({
        schoolId: school.id,
        sessionId: session.id,
        admissionId: secondAdmission.id,
        sectionId: sections[0]!.id,
        rollNo: 3,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));

    await expect(
      createTestClient(manager.session).school.removeStudentFromClass({
        schoolId: school.id,
        sessionId: session.id,
        studentId: first.id,
        confirmationRollNo: 99,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));

    const detached = await createTestClient(manager.session).school.removeStudentFromClass({
      schoolId: school.id,
      sessionId: session.id,
      studentId: first.id,
      confirmationRollNo: 1,
    });
    expect(detached).toMatchObject({
      classId: null,
      sectionId: null,
      rollNo: null,
    });

    const unassigned = await createTestClient(
      teacher.session,
    ).school.listStudents({
      schoolId: school.id,
      sessionId: session.id,
      filters: { unassigned: true },
    });
    expect(unassigned.items.map(({ id }) => id)).toEqual([first.id]);

    const moved = await createTestClient(manager.session).school.updateStudent({
      schoolId: school.id,
      sessionId: session.id,
      studentId: first.id,
      sectionId: sections[1]!.id,
      rollNo: 1,
    });
    expect(moved.sectionId).toBe(sections[1]!.id);

    await expect(
      createTestClient(teacher.session).school.getStudent({
        schoolId: school.id,
        sessionId: session.id,
        studentId: first.id,
      }),
    ).resolves.toMatchObject({ id: first.id });
    await expect(
      createTestClient(manager.session).school.deleteStudent({
        schoolId: school.id,
        sessionId: session.id,
        studentId: first.id,
      }),
    ).resolves.toMatchObject({ id: first.id });
  });

  it("irreversibly unregisters by exact-name confirmation and blocks later admission or student mutations", async () => {
    const school = await createTestSchool();
    const session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2038,
      sessionEndYear: 2039,
    });
    const { sections } = await createTestClass({ schoolId: school.id });
    const admission = await createTestAdmission({
      schoolId: school.id,
      name: "Aarav Sharma",
    });
    const student = await createTestStudent({
      schoolId: school.id,
      admissionId: admission.id,
      sessionId: session.id,
      classId: sections[0]!.classId,
      sectionId: sections[0]!.id,
      rollNo: 7,
    });
    const manager = await createSchoolStaffSession(school.id, [
      { role: "manager", meta: null },
    ]);
    const teacher = await createSchoolStaffSession(school.id, [
      { role: "teacher", meta: { classIds: [] } },
    ]);
    const client = createTestClient(manager.session);
    const inactiveAdmission = await createTestAdmission({
      schoolId: school.id,
      registered: false,
    });
    await expect(
      client.school.createStudent({
        schoolId: school.id,
        sessionId: session.id,
        admissionId: inactiveAdmission.id,
        sectionId: sections[0]!.id,
        rollNo: 8,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));

    await expect(
      createTestClient(null).school.unregisterAdmission({
        schoolId: school.id,
        admissionId: admission.id,
        confirmationName: admission.name,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "UNAUTHORIZED" }));
    await expect(
      createTestClient(teacher.session).school.unregisterAdmission({
        schoolId: school.id,
        admissionId: admission.id,
        confirmationName: admission.name,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
    await expect(
      client.school.unregisterAdmission({
        schoolId: school.id,
        admissionId: admission.id,
        confirmationName: "Wrong name",
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));

    const unregistered = await client.school.unregisterAdmission({
      schoolId: school.id,
      admissionId: admission.id,
      confirmationName: admission.name,
    });
    expect(unregistered.registered).toBe(false);
    expect(unregistered.unregisteredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const inactive = await client.school.listAdmissions({
      schoolId: school.id,
      filters: { registered: false },
    });
    expect(inactive.items.map(({ id }) => id)).toContain(admission.id);

    await expect(
      client.school.unregisterAdmission({
        schoolId: school.id,
        admissionId: admission.id,
        confirmationName: admission.name,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
    await expect(
      client.school.updateAdmission({
        schoolId: school.id,
        admissionId: admission.id,
        address: "New address",
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
    await expect(
      client.school.updateStudent({
        schoolId: school.id,
        sessionId: session.id,
        studentId: student.id,
        rollNo: 8,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
    await expect(
      client.school.removeStudentFromClass({
        schoolId: school.id,
        sessionId: session.id,
        studentId: student.id,
        confirmationRollNo: 7,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
    await expect(
      client.school.deleteStudent({
        schoolId: school.id,
        sessionId: session.id,
        studentId: student.id,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("enforces one student row per admission and session and unique section roll numbers", async () => {
    const school = await createTestSchool();
    const session = await createTestSession({
      schoolId: school.id,
      sessionStartYear: 2036,
      sessionEndYear: 2037,
    });
    const { sections } = await createTestClass({
      schoolId: school.id,
    });
    const manager = await createSchoolStaffSession(school.id, [
      { role: "manager", meta: null },
    ]);
    const firstAdmission = await createTestAdmission({ schoolId: school.id });
    const secondAdmission = await createTestAdmission({ schoolId: school.id });
    const client = createTestClient(manager.session);
    const base = {
      schoolId: school.id,
      sessionId: session.id,
      sectionId: sections[0]!.id,
      rollNo: 1,
    };

    await client.school.createStudent({
      ...base,
      admissionId: firstAdmission.id,
    });
    await expect(
      client.school.createStudent({
        ...base,
        admissionId: firstAdmission.id,
        rollNo: 2,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    await expect(
      client.school.createStudent({
        ...base,
        admissionId: secondAdmission.id,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "CONFLICT" }));
  });
});
