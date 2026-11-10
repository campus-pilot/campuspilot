import { db } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { expectRpcCode } from "../../../../test/finance/assertions";
import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestClient,
  createTestSchool,
} from "../../../../test/fixtures";

function admissionInput(schoolId: string, admissionNo: string) {
  return {
    schoolId,
    name: `Student ${admissionNo}`,
    admissionNo,
    address: "Test address",
    phoneNo: "98765 43210",
    whatsappSameAsPhone: true,
    whatsappVerified: true,
    dob: "2016-01-01",
    fatherName: "Test Father",
    motherName: "Test Mother",
  };
}

async function principalClient() {
  const school = await createTestSchool();
  const principal = await createSchoolStaffSession(school.id, [{ role: "principal", meta: null }]);
  return { school, client: createTestClient(principal.session) };
}

describe("admission phone and WhatsApp fields", () => {
  it("stores E.164 numbers and the explicit WhatsApp facts", async () => {
    const { school, client } = await principalClient();
    const created = await client.school.createAdmission(admissionInput(school.id, "WA-1"));
    expect(created).toMatchObject({
      phoneNo: "+919876543210",
      whatsappNo: "+919876543210",
      whatsappSameAsPhone: true,
      whatsappVerified: true,
      whatsappConsent: false,
    });

    const separate = await client.school.createAdmission({
      ...admissionInput(school.id, "WA-2"),
      whatsappSameAsPhone: false,
      whatsappNo: "+1 415 555 2671",
      whatsappVerified: false,
      whatsappConsent: true,
    });
    expect(separate).toMatchObject({ whatsappNo: "+14155552671", whatsappSameAsPhone: false, whatsappConsent: true });
  });

  it("refuses invalid phone numbers and inconsistent WhatsApp input", async () => {
    const { school, client } = await principalClient();
    await expectRpcCode(client.school.createAdmission({ ...admissionInput(school.id, "WA-BAD"), phoneNo: "12345" }), "BAD_REQUEST");
    await expectRpcCode(
      client.school.createAdmission({ ...admissionInput(school.id, "WA-MISMATCH"), whatsappNo: "9123456789" }),
      "BAD_REQUEST",
    );
    await expectRpcCode(
      client.school.createAdmission({ ...admissionInput(school.id, "WA-NOVERIFY"), whatsappSameAsPhone: false, whatsappVerified: true }),
      "BAD_REQUEST",
    );
  });

  it("keeps the WhatsApp number following the phone while it is the same", async () => {
    const { school, client } = await principalClient();
    const created = await client.school.createAdmission(admissionInput(school.id, "WA-FOLLOW"));
    const updated = await client.school.updateAdmission({ schoolId: school.id, admissionId: created.id, phoneNo: "9123456789" });
    expect(updated).toMatchObject({ phoneNo: "+919123456789", whatsappNo: "+919123456789", whatsappVerified: false });
  });

  it("reads and edits an admission whose phone was never migrated", async () => {
    const { school, client } = await principalClient();
    const legacy = await createTestAdmission({ schoolId: school.id });
    await db.update(admissionTable).set({ phoneNo: "+91 ask at the office" }).where(eq(admissionTable.id, legacy.id));

    const read = await client.school.getAdmission({ schoolId: school.id, admissionId: legacy.id });
    expect(read).toMatchObject({ phoneNo: "+91 ask at the office", whatsappNo: null, whatsappSameAsPhone: null, whatsappVerified: false, whatsappConsent: false });
    // Unrelated edits work; using the bad phone as the WhatsApp number does not.
    await expect(client.school.updateAdmission({ schoolId: school.id, admissionId: legacy.id, name: "Renamed" })).resolves.toMatchObject({ name: "Renamed" });
    await expectRpcCode(
      client.school.updateAdmission({ schoolId: school.id, admissionId: legacy.id, whatsappSameAsPhone: true }),
      "BAD_REQUEST",
    );
    await expect(
      client.school.updateAdmission({ schoolId: school.id, admissionId: legacy.id, phoneNo: "9876543210", whatsappSameAsPhone: true, whatsappVerified: true }),
    ).resolves.toMatchObject({ phoneNo: "+919876543210", whatsappNo: "+919876543210", whatsappSameAsPhone: true, whatsappVerified: true });
  });
});
