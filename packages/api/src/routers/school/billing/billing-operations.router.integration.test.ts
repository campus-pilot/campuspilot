import { db } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { classTable } from "@campuspilot/db/schema/class";
import {
  financeAdmissionBalanceTable,
  financeAdmissionSessionActivityTable,
  financeBillLineTable,
  financeBillRunTable,
  financeBillTable,
  financeLedgerEntryTable,
  financeNumberCounterTable,
  financePaymentAllocationTable,
  financePaymentTable,
} from "@campuspilot/db/schema/finance";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { studentTable } from "@campuspilot/db/schema/student";
import { and, count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createTestAdmission,
  createTestClass,
  createTestStudent,
} from "../../../../test/fixtures";

import {
  createFinanceConfig,
  createFinanceIdempotencyKey,
} from "../../../../test/finance/factories";
import {
  createFinanceScenario,
  type FinanceScenario,
} from "../../../../test/finance/scenario";

function postableConfig() {
  return createFinanceConfig({
    recurring: "monthly",
    elements: {
      tuition: {
        name: "Tuition",
        scopes: ["class", "student"],
        requiredAtLevel: "class",
        defaultAmountMinor: 10_000,
      },
      transport: {
        name: "Transport",
        scopes: ["school", "student"],
        requiredAtLevel: "bill_generation",
      },
    },
  });
}

async function configuredScenario() {
  const scenario = await createFinanceScenario({
    activeValues: { transport: 500 },
    historicalValues: { transport: 600 },
  });
  const config = postableConfig();
  await db
    .update(schoolSessionTable)
    .set({
      financeConfig: config,
      financeClassOverrides: {
        [scenario.schoolClass.slug]: { tuition: 12_000 },
      },
    })
    .where(
      and(
        eq(schoolSessionTable.schoolId, scenario.school.id),
        eq(schoolSessionTable.id, scenario.activeSession.id),
      ),
    );
  await db
    .update(schoolSessionTable)
    .set({
      financeConfig: config,
      financeClassOverrides: {
        [scenario.schoolClass.slug]: { tuition: 11_000 },
      },
    })
    .where(
      and(
        eq(schoolSessionTable.schoolId, scenario.school.id),
        eq(schoolSessionTable.id, scenario.historicalSession.id),
      ),
    );
  return scenario;
}

function draft(scenario: FinanceScenario, historical = false) {
  return {
    schoolId: scenario.school.id,
    sessionId: historical
      ? scenario.historicalSession.id
      : scenario.activeSession.id,
    billingDate: historical ? "2040-02-10" : "2040-05-10",
    runValues: { session: {}, classes: {} },
  };
}

type RollbackStage = "projection" | "line" | "finalization";

async function installScopedFailureTrigger(stage: RollbackStage, schoolId: string) {
  const target = {
    projection: { table: "finance_admission_balance", event: "INSERT" },
    line: { table: "finance_bill_line", event: "INSERT" },
    finalization: { table: "finance_bill", event: "UPDATE" },
  }[stage];
  const functionName = `test_finance_${stage}_failure`;
  const triggerName = `${functionName}_trigger`;
  const schoolLiteral = schoolId.replaceAll("'", "''");
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.school_id = '${schoolLiteral}' THEN
        RAISE EXCEPTION 'scoped finance ${stage} failure';
      END IF;
      RETURN NEW;
    END;
    $fn$;
    DROP TRIGGER IF EXISTS ${triggerName} ON ${target.table};
    CREATE TRIGGER ${triggerName} BEFORE ${target.event} ON ${target.table}
    FOR EACH ROW EXECUTE FUNCTION ${functionName}();
  `));
  return async () => {
    await db.execute(
      sql.raw(`
        DROP TRIGGER IF EXISTS ${triggerName} ON ${target.table};
        DROP FUNCTION IF EXISTS ${functionName}();
      `),
    );
  };
}

describe("school billing operations", () => {
  let scenario: FinanceScenario;

  beforeEach(async () => {
    scenario = await configuredScenario();
  });

  it("previews exact source snapshots without writes and enforces the actor matrix", async () => {
    const before = await db
      .select({ value: count() })
      .from(financeBillRunTable)
      .where(eq(financeBillRunTable.schoolId, scenario.school.id));
    const preview = await scenario.actors.principal.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    expect(preview).toMatchObject({
      readyToPost: true,
      currency: "INR",
      counts: { selected: 1, eligible: 1, skipped: 0 },
      totalAmountMinor: "12500",
      period: { key: "monthly:2040-05" },
    });
    expect(preview.breakdown.items[0]?.lines).toEqual([
      expect.objectContaining({
        feeElementSlug: "transport",
        amountMinor: "500",
        pricingSourceKind: "admission",
      }),
      expect.objectContaining({
        feeElementSlug: "tuition",
        amountMinor: "12000",
        pricingSourceKind: "class",
      }),
    ]);
    const after = await db
      .select({ value: count() })
      .from(financeBillRunTable)
      .where(eq(financeBillRunTable.schoolId, scenario.school.id));
    expect(after[0]?.value).toBe(before[0]?.value);

    await expect(
      scenario.actors.accountant.client.school.previewBillingRun({
        ...draft(scenario),
        page: 1,
        limit: 20,
      }),
    ).resolves.toMatchObject({ readyToPost: true });
    await expect(
      scenario.actors.teacher.client.school.previewBillingRun({
        ...draft(scenario),
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      scenario.actors.platformAdmin.client.school.previewBillingRun({
        ...draft(scenario),
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      scenario.actors.principal.client.school.previewBillingRun({
        ...draft(scenario),
        billingDate: "2040-02-31",
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeDefined();
    await expect(
      scenario.actors.principal.client.school.createManualBill({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        admissionId: scenario.admission.id,
        issueDate: "2040-05-01",
        reason: "Out of range",
        idempotencyKey: createFinanceIdempotencyKey("out-of-range"),
        lines: [
          {
            title: "Out-of-range charge",
            amountMinor: "9223372036854775808",
          },
        ],
      }),
    ).rejects.toBeDefined();
  });

  it("applies explicit bill-generation values independently for every class", async () => {
    const [{ schoolClass: secondClass, sections }, secondAdmission] =
      await Promise.all([
        createTestClass({ schoolId: scenario.school.id }),
        createTestAdmission({ schoolId: scenario.school.id }),
      ]);
    await createTestStudent({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      admissionId: secondAdmission.id,
      classId: secondClass.id,
      sectionId: sections[0]!.id,
      rollNo: 2,
    });
    await db
      .update(schoolSessionTable)
      .set({
        financeConfig: createFinanceConfig({
          recurring: "monthly",
          elements: {
            tuition: {
              name: "Tuition",
              scopes: ["class"],
              requiredAtLevel: "class",
              defaultAmountMinor: 10_000,
            },
            laboratory: {
              name: "Laboratory",
              scopes: ["class"],
              requiredAtLevel: "bill_generation",
            },
          },
        }),
        financeClassOverrides: {},
      })
      .where(eq(schoolSessionTable.id, scenario.activeSession.id));
    await db
      .update(admissionTable)
      .set({ financeValue: { [scenario.activeSession.id]: {} } })
      .where(eq(admissionTable.id, scenario.admission.id));

    const runValues = {
      session: {},
      classes: {
        [scenario.schoolClass.id]: { laboratory: "1000" },
        [secondClass.id]: { laboratory: "2500" },
      },
    };
    const preview =
      await scenario.actors.manager.client.school.previewBillingRun({
        ...draft(scenario),
        runValues,
        page: 1,
        limit: 20,
      });

    expect(preview).toMatchObject({
      readyToPost: true,
      counts: { selected: 2, eligible: 2, skipped: 0 },
      totalAmountMinor: "23500",
    });
    const byClass = new Map(
      preview.breakdown.items.map((item) => [item.classId, item]),
    );
    expect(byClass.get(scenario.schoolClass.id)).toMatchObject({
      totalAmountMinor: "11000",
      lines: expect.arrayContaining([
        expect.objectContaining({
          feeElementSlug: "laboratory",
          amountMinor: "1000",
          pricingSourceKind: "run_class",
        }),
      ]),
    });
    expect(byClass.get(secondClass.id)).toMatchObject({
      totalAmountMinor: "12500",
      lines: expect.arrayContaining([
        expect.objectContaining({
          feeElementSlug: "laboratory",
          amountMinor: "2500",
          pricingSourceKind: "run_class",
        }),
      ]),
    });

    await expect(
      scenario.actors.manager.client.school.postBillingRun({
        ...draft(scenario),
        runValues,
        expectedConfigurationHash: preview.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("class-run-values"),
        kind: "regular",
      }),
    ).resolves.toMatchObject({ billCount: 2, totalAmountMinor: "23500" });
  });

  it("rejects explicit empty selections for preview and post without widening scope", async () => {
    const client = scenario.actors.manager.client.school;
    await expect(
      client.previewBillingRun({
        ...draft(scenario),
        admissionIds: [],
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeDefined();
    await expect(
      client.previewBillingRun({
        ...draft(scenario),
        classIds: [],
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeDefined();
    await expect(
      client.postBillingRun({
        ...draft(scenario),
        admissionIds: [],
        expectedConfigurationHash: "a".repeat(64),
        idempotencyKey: createFinanceIdempotencyKey("empty-selection"),
        kind: "regular",
      }),
    ).rejects.toBeDefined();
    const [runs] = await db
      .select({ value: count() })
      .from(financeBillRunTable)
      .where(eq(financeBillRunTable.schoolId, scenario.school.id));
    expect(runs?.value).toBe(0);
  });

  it("blocks mixed valid and foreign class selections without leaking or widening", async () => {
    const foreign = await createTestClass({ schoolId: scenario.outsiderSchool.id });
    const missingId = "class-not-present";
    const selection = {
      ...draft(scenario),
      classIds: [scenario.schoolClass.id, foreign.schoolClass.id, missingId],
    };
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...selection,
      page: 1,
      limit: 20,
      issuePage: 1,
      issueLimit: 20,
    });
    expect(preview).toMatchObject({
      readyToPost: false,
      counts: { eligible: 1 },
    });
    const selectionIssues = preview.issues.items.filter(
      ({ code }) => code === "invalid_selection",
    );
    expect(selectionIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: foreign.schoolClass.id,
        entityLabel: foreign.schoolClass.id,
        blocking: true,
      }),
      expect.objectContaining({
        entityId: missingId,
        entityLabel: missingId,
        blocking: true,
      }),
    ]));
    expect(JSON.stringify(selectionIssues)).not.toContain(foreign.schoolClass.label);
    await expect(
      scenario.actors.manager.client.school.postBillingRun({
        ...selection,
        expectedConfigurationHash: preview.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("foreign-class-selection"),
        kind: "regular",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [runs] = await db
      .select({ value: count() })
      .from(financeBillRunTable)
      .where(eq(financeBillRunTable.schoolId, scenario.school.id));
    expect(runs?.value).toBe(0);
  });

  it("rejects incomplete configuration and stale pricing or enrollment reviews without writes", async () => {
    await db
      .update(schoolSessionTable)
      .set({ financeConfig: { recurring: "monthly", elements: postableConfig().elements } })
      .where(eq(schoolSessionTable.id, scenario.activeSession.id));
    const incomplete = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    expect(incomplete.readyToPost).toBe(false);
    expect(incomplete.period).toBeNull();
    expect(incomplete.issues.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_configuration", blocking: true }),
      ]),
    );

    await db
      .update(schoolSessionTable)
      .set({
        financeConfig: postableConfig(),
        financeClassOverrides: {
          [scenario.schoolClass.slug]: { tuition: 12_000 },
        },
      })
      .where(eq(schoolSessionTable.id, scenario.activeSession.id));
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    await db
      .update(schoolSessionTable)
      .set({
        financeClassOverrides: {
          [scenario.schoolClass.slug]: { tuition: 13_000 },
        },
      })
      .where(eq(schoolSessionTable.id, scenario.activeSession.id));
    await expect(
      scenario.actors.manager.client.school.postBillingRun({
        ...draft(scenario),
        expectedConfigurationHash: preview.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("stale-config"),
        kind: "regular",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const fresh = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    await db
      .update(admissionTable)
      .set({ registered: false, unregisteredAt: new Date() })
      .where(eq(admissionTable.id, scenario.admission.id));
    await expect(
      scenario.actors.manager.client.school.postBillingRun({
        ...draft(scenario),
        expectedConfigurationHash: fresh.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("stale-enrollment"),
        kind: "regular",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const rows = await db
      .select({ value: count() })
      .from(financeBillRunTable)
      .where(eq(financeBillRunTable.schoolId, scenario.school.id));
    expect(rows[0]?.value).toBe(0);
  });

  it("paginates readiness issues and captures unresolved pricing candidates exactly", async () => {
    const config = postableConfig();
    await Promise.all([
      db
        .update(schoolSessionTable)
        .set({
          financeConfig: {
            ...config,
            elements: {
              ...config.elements,
              meals: {
                name: "Meals",
                scopes: ["school"],
                requiredAtLevel: "bill_generation",
              },
            },
          },
        })
        .where(eq(schoolSessionTable.id, scenario.activeSession.id)),
      db
        .update(admissionTable)
        .set({ financeValue: { [scenario.activeSession.id]: {} } })
        .where(eq(admissionTable.id, scenario.admission.id)),
    ]);
    const first = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
      issuePage: 1,
      issueLimit: 1,
    });
    expect(first.issues.pagination).toMatchObject({
      currentPage: 1,
      totalPages: 2,
      totalItems: 2,
      nextCursor: "2",
    });
    expect(first.issues.items[0]).toMatchObject({
      code: "unresolved_price",
      blocking: true,
      pricingResolutionSnapshot: {
        candidates: {
          admission: null,
          class: null,
          runClass: null,
          runSession: null,
          fallback: null,
        },
      },
    });
    const second = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
      issuePage: 2,
      issueLimit: 1,
    });
    expect(second.configurationHash).toBe(first.configurationHash);
    expect(second.issues.pagination.nextCursor).toBeNull();
    expect(second.issues.items).toHaveLength(1);
  });

  it("blocks exact-money aggregate overflow before any finance write", async () => {
    const config = postableConfig();
    await db
      .update(schoolSessionTable)
      .set({
        financeConfig: {
          ...config,
          elements: {
            ...config.elements,
            transport: {
              name: "Transport",
              scopes: ["school"],
              requiredAtLevel: "bill_generation",
            },
          },
        },
      })
      .where(eq(schoolSessionTable.id, scenario.activeSession.id));
    await db
      .update(admissionTable)
      .set({ financeValue: { [scenario.activeSession.id]: {} } })
      .where(eq(admissionTable.id, scenario.admission.id));
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      runValues: {
        session: { transport: "9223372036854775807" },
        classes: {},
      },
      page: 1,
      limit: 20,
    });
    expect(preview.readyToPost).toBe(false);
    expect(preview.issues.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "amount_overflow", blocking: true }),
      ]),
    );
    await expect(
      scenario.actors.manager.client.school.createManualBill({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        admissionId: scenario.admission.id,
        issueDate: "2040-05-01",
        reason: "Overflow must not reach the database",
        idempotencyKey: createFinanceIdempotencyKey("manual-overflow"),
        lines: [
          { title: "Primary charge", amountMinor: "9223372036854775807" },
          { title: "Overflowing charge", amountMinor: "1" },
        ],
      }),
    ).rejects.toBeDefined();
    const [entries] = await db
      .select({ value: count() })
      .from(financeLedgerEntryTable)
      .where(eq(financeLedgerEntryTable.schoolId, scenario.school.id));
    expect(entries?.value).toBe(0);
  });

  it("binds a selected review only to relevant class overrides", async () => {
    const other = await createTestClass({ schoolId: scenario.school.id });
    await db
      .update(schoolSessionTable)
      .set({
        financeClassOverrides: {
          [scenario.schoolClass.slug]: { tuition: 12_000 },
          [other.schoolClass.slug]: { tuition: 20_000 },
        },
      })
      .where(eq(schoolSessionTable.id, scenario.activeSession.id));
    const selectedDraft = {
      ...draft(scenario),
      admissionIds: [scenario.admission.id],
    };
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...selectedDraft,
      page: 1,
      limit: 20,
    });
    await db
      .update(schoolSessionTable)
      .set({
        financeClassOverrides: {
          [scenario.schoolClass.slug]: { tuition: 12_000 },
          [other.schoolClass.slug]: { tuition: 99_999 },
        },
      })
      .where(eq(schoolSessionTable.id, scenario.activeSession.id));
    await expect(
      scenario.actors.manager.client.school.postBillingRun({
        ...selectedDraft,
        expectedConfigurationHash: preview.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("relevant-selection"),
        kind: "regular",
      }),
    ).resolves.toMatchObject({ totalAmountMinor: "12500", billCount: 1 });
  });

  it("posts regular and historical runs atomically with idempotency payload semantics", async () => {
    const preview = await scenario.actors.accountant.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    const key = createFinanceIdempotencyKey("post");
    const command = {
      ...draft(scenario),
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: key,
      kind: "regular" as const,
    };
    const posted = await scenario.actors.accountant.client.school.postBillingRun(command);
    expect(posted).toMatchObject({
      status: "posted",
      totalAmountMinor: "12500",
      billCount: 1,
    });
    await expect(
      scenario.actors.accountant.client.school.postBillingRun(command),
    ).resolves.toMatchObject({ id: posted.id });
    await expect(
      scenario.actors.accountant.client.school.postBillingRun({
        ...command,
        kind: "supplemental",
        supplementalReason: "Different command",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const historicalPreview =
      await scenario.actors.principal.client.school.previewBillingRun({
        ...draft(scenario, true),
        page: 1,
        limit: 20,
      });
    await expect(
      scenario.actors.principal.client.school.postBillingRun({
        ...draft(scenario, true),
        expectedConfigurationHash: historicalPreview.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("historical"),
        kind: "regular",
      }),
    ).resolves.toMatchObject({ sessionId: scenario.historicalSession.id });

    const [billCountRow, lineCountRow, ledgerCountRow] = await Promise.all([
      db.select({ value: count() }).from(financeBillTable).where(eq(financeBillTable.billRunId, posted.id)),
      db.select({ value: count() }).from(financeBillLineTable).where(eq(financeBillLineTable.schoolId, scenario.school.id)),
      db.select({ value: count() }).from(financeLedgerEntryTable).where(eq(financeLedgerEntryTable.schoolId, scenario.school.id)),
    ]);
    expect(billCountRow[0]?.value).toBe(1);
    expect(lineCountRow[0]?.value).toBe(4);
    expect(ledgerCountRow[0]?.value).toBe(2);
  });

  it("posts a realistic run across every bounded write chunk with one number reservation", async () => {
    const extraAdmissions = await db
      .insert(admissionTable)
      .values(
        Array.from({ length: 501 }, (_, index) => ({
          schoolId: scenario.school.id,
          name: `Bulk Student ${index}`,
          admissionNo: `BULK-${String(index).padStart(4, "0")}`,
          address: "Bulk test address",
          phoneNo: `9000${String(index).padStart(6, "0")}`,
          dob: "2015-01-01",
          fatherName: "Bulk Father",
          motherName: "Bulk Mother",
          financeValue: {
            [scenario.activeSession.id]: { transport: 500 },
          },
        })),
      )
      .returning({ id: admissionTable.id });
    await db.insert(studentTable).values(
      extraAdmissions.map(({ id }, index) => ({
        schoolId: scenario.school.id,
        admissionId: id,
        sessionId: scenario.activeSession.id,
        classId: scenario.schoolClass.id,
        sectionId: scenario.section.id,
        rollNo: index + 2,
      })),
    );
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    expect(preview.counts).toMatchObject({ selected: 502, eligible: 502 });
    const run = await scenario.actors.manager.client.school.postBillingRun({
      ...draft(scenario),
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: createFinanceIdempotencyKey("bulk-chunked"),
      kind: "regular",
    });
    expect(run).toMatchObject({
      billCount: 502,
      totalAmountMinor: String(502 * 12_500),
    });
    const [bills, lines, balances, counter] = await Promise.all([
      db
        .select({ value: count() })
        .from(financeBillTable)
        .where(eq(financeBillTable.billRunId, run.id)),
      db
        .select({ value: count() })
        .from(financeBillLineTable)
        .where(eq(financeBillLineTable.schoolId, scenario.school.id)),
      db
        .select({ value: count() })
        .from(financeAdmissionBalanceTable)
        .where(eq(financeAdmissionBalanceTable.schoolId, scenario.school.id)),
      db
        .select()
        .from(financeNumberCounterTable)
        .where(
          and(
            eq(financeNumberCounterTable.schoolId, scenario.school.id),
            eq(financeNumberCounterTable.sessionId, scenario.activeSession.id),
            eq(financeNumberCounterTable.kind, "bill"),
          ),
        ),
    ]);
    expect(bills[0]?.value).toBe(502);
    expect(lines[0]?.value).toBe(1004);
    expect(balances[0]?.value).toBe(502);
    expect(counter[0]?.nextValue).toBe(BigInt(503));
    const reversalInput = {
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      billRunId: run.id,
      effectiveAt: new Date("2040-05-20T00:00:00.000Z"),
      reason: "Bulk chunk reversal",
      idempotencyKey: createFinanceIdempotencyKey("bulk-chunked-reversal"),
    };
    const reversed =
      await scenario.actors.manager.client.school.reverseBillingRun(
        reversalInput,
      );
    expect(reversed).toMatchObject({
      reversedBillCount: 502,
      totalAmountMinor: String(502 * 12_500),
      currency: "INR",
    });
    await expect(
      scenario.actors.manager.client.school.reverseBillingRun(reversalInput),
    ).resolves.toEqual(reversed);
    const [reversalCount] = await db
      .select({ value: count() })
      .from(financeLedgerEntryTable)
      .where(
        and(
          eq(financeLedgerEntryTable.schoolId, scenario.school.id),
          eq(financeLedgerEntryTable.type, "reversal"),
        ),
      );
    expect(reversalCount?.value).toBe(502);
  });

  it("bounds an oversized full-school preview and post before finance writes", async () => {
    let created = 0;
    while (created < 5000) {
      const size = Math.min(500, 5000 - created);
      const admissions = await db
        .insert(admissionTable)
        .values(
          Array.from({ length: size }, (_, offset) => {
            const index = created + offset;
            return {
              schoolId: scenario.school.id,
              name: `Oversized Student ${index}`,
              admissionNo: `OVER-${String(index).padStart(5, "0")}`,
              address: "Oversized test address",
              phoneNo: `8${String(index).padStart(9, "0")}`,
              dob: "2015-01-01",
              fatherName: "Oversized Father",
              motherName: "Oversized Mother",
            };
          }),
        )
        .returning({ id: admissionTable.id });
      await db.insert(studentTable).values(
        admissions.map(({ id }, offset) => ({
          schoolId: scenario.school.id,
          admissionId: id,
          sessionId: scenario.activeSession.id,
          classId: scenario.schoolClass.id,
          sectionId: scenario.section.id,
          rollNo: created + offset + 2,
        })),
      );
      created += size;
    }
    const indexResult = await db.execute<{ indexname: string }>(sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'student'
        and indexname in (
          'student_school_session_admission_id_idx',
          'student_school_session_class_admission_id_idx'
        )
      order by indexname
    `);
    expect(indexResult.rows.map(({ indexname }) => indexname)).toEqual([
      "student_school_session_admission_id_idx",
      "student_school_session_class_admission_id_idx",
    ]);
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    expect(preview).toMatchObject({
      readyToPost: false,
      counts: { selected: 5001, eligible: 0 },
    });
    expect(preview.issues.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "run_too_large", blocking: true }),
      ]),
    );
    await expect(
      scenario.actors.manager.client.school.postBillingRun({
        ...draft(scenario),
        expectedConfigurationHash: preview.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("oversized-post"),
        kind: "regular",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [runs, bills, entries, balances, counters] = await Promise.all([
      db.select({ value: count() }).from(financeBillRunTable).where(eq(financeBillRunTable.schoolId, scenario.school.id)),
      db.select({ value: count() }).from(financeBillTable).where(eq(financeBillTable.schoolId, scenario.school.id)),
      db.select({ value: count() }).from(financeLedgerEntryTable).where(eq(financeLedgerEntryTable.schoolId, scenario.school.id)),
      db.select({ value: count() }).from(financeAdmissionBalanceTable).where(eq(financeAdmissionBalanceTable.schoolId, scenario.school.id)),
      db.select({ value: count() }).from(financeNumberCounterTable).where(eq(financeNumberCounterTable.schoolId, scenario.school.id)),
    ]);
    expect([runs, bills, entries, balances, counters].map((rows) => rows[0]?.value)).toEqual([0, 0, 0, 0, 0]);
  });

  it("allows one true concurrent regular run and preserves one posted charge", async () => {
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    const results = await Promise.allSettled(
      ["race-a", "race-b"].map((label) =>
        scenario.actors.manager.client.school.postBillingRun({
          ...draft(scenario),
          expectedConfigurationHash: preview.configurationHash,
          idempotencyKey: createFinanceIdempotencyKey(label),
          kind: "regular",
        }),
      ),
    );
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "CONFLICT" });
    const runs = await db
      .select({ value: count() })
      .from(financeBillRunTable)
      .where(eq(financeBillRunTable.schoolId, scenario.school.id));
    expect(runs[0]?.value).toBe(1);
  });

  it("gives stable concurrent same-key idempotency semantics", async () => {
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    const sharedKey = createFinanceIdempotencyKey("same-key-same-payload");
    const command = {
      ...draft(scenario),
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: sharedKey,
      kind: "regular" as const,
    };
    const sameResults = await Promise.allSettled([
      scenario.actors.manager.client.school.postBillingRun(command),
      scenario.actors.manager.client.school.postBillingRun(command),
    ]);
    const sameSuccessIds = sameResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.id] : [],
    );
    expect(sameSuccessIds.length).toBeGreaterThanOrEqual(1);
    expect(new Set(sameSuccessIds).size).toBe(1);
    for (const result of sameResults) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "CONFLICT" });
      }
    }

    const otherScenario = await configuredScenario();
    const otherPreview =
      await otherScenario.actors.manager.client.school.previewBillingRun({
        ...draft(otherScenario),
        page: 1,
        limit: 20,
      });
    const collisionKey = createFinanceIdempotencyKey("same-key-different-payload");
    const differentResults = await Promise.allSettled([
      otherScenario.actors.manager.client.school.postBillingRun({
        ...draft(otherScenario),
        expectedConfigurationHash: otherPreview.configurationHash,
        idempotencyKey: collisionKey,
        kind: "regular",
      }),
      otherScenario.actors.manager.client.school.postBillingRun({
        ...draft(otherScenario),
        expectedConfigurationHash: otherPreview.configurationHash,
        idempotencyKey: collisionKey,
        kind: "supplemental",
        supplementalReason: "Different payload",
      }),
    ]);
    expect(
      differentResults.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const differentRejected = differentResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(differentRejected).toHaveLength(1);
    expect(differentRejected[0]!.reason).toMatchObject({ code: "CONFLICT" });
  });

  it("serializes concurrent enrollment and posting without a lock-order deadlock", async () => {
    const admission = await createTestAdmission({ schoolId: scenario.school.id });
    await db
      .update(admissionTable)
      .set({ financeValue: { [scenario.activeSession.id]: { transport: 800 } } })
      .where(eq(admissionTable.id, admission.id));
    const selectedDraft = {
      ...draft(scenario),
      admissionIds: [admission.id],
    };
    const stale = await scenario.actors.manager.client.school.previewBillingRun({
      ...selectedDraft,
      page: 1,
      limit: 20,
    });
    expect(stale.readyToPost).toBe(false);
    const [enrollmentResult, postingResult] = await Promise.allSettled([
      scenario.actors.manager.client.school.createStudent({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        admissionId: admission.id,
        sectionId: scenario.section.id,
        rollNo: 77,
      }),
      scenario.actors.manager.client.school.postBillingRun({
        ...selectedDraft,
        expectedConfigurationHash: stale.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("enrollment-race-stale"),
        kind: "regular",
      }),
    ]);
    expect(enrollmentResult.status).toBe("fulfilled");
    expect(postingResult.status).toBe("rejected");
    if (postingResult.status === "rejected") {
      expect(["BAD_REQUEST", "CONFLICT"]).toContain(postingResult.reason.code);
    }
    const fresh = await scenario.actors.manager.client.school.previewBillingRun({
      ...selectedDraft,
      page: 1,
      limit: 20,
    });
    expect(fresh.readyToPost).toBe(true);
    await expect(
      scenario.actors.manager.client.school.postBillingRun({
        ...selectedDraft,
        expectedConfigurationHash: fresh.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("enrollment-race-valid"),
        kind: "regular",
      }),
    ).resolves.toMatchObject({ billCount: 1, totalAmountMinor: "12800" });
  });

  it("requires an explicit supplemental reason and permits a supplemental run beside the regular period", async () => {
    const preview = await scenario.actors.principal.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    const regular = await scenario.actors.principal.client.school.postBillingRun({
      ...draft(scenario),
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: createFinanceIdempotencyKey("regular"),
      kind: "regular",
    });
    await expect(
      scenario.actors.principal.client.school.postBillingRun({
        ...draft(scenario),
        expectedConfigurationHash: preview.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("supplemental-missing-reason"),
        kind: "supplemental",
      }),
    ).rejects.toBeDefined();
    const supplemental =
      await scenario.actors.principal.client.school.postBillingRun({
        ...draft(scenario),
        expectedConfigurationHash: preview.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("supplemental"),
        kind: "supplemental",
        supplementalReason: "Approved mid-period transport correction",
      });
    expect(supplemental).toMatchObject({
      kind: "supplemental",
      periodKey: regular.periodKey,
      supplementalReason: "Approved mid-period transport correction",
    });
    const listed = await scenario.actors.platformAdmin.client.school.listBillingRuns({
      schoolId: scenario.school.id,
      filters: { sessionId: scenario.activeSession.id },
      orderBy: { field: "recordedAt", direction: "desc" },
      limit: 20,
    });
    expect(listed.pagination.totalItems).toBe(2);
    expect(listed.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([regular.id, supplemental.id]),
    );
    const firstPage =
      await scenario.actors.platformAdmin.client.school.listBillingRuns({
        schoolId: scenario.school.id,
        filters: { sessionId: scenario.activeSession.id },
        orderBy: { field: "recordedAt", direction: "asc" },
        limit: 1,
      });
    expect(firstPage.pagination).toMatchObject({
      currentPage: 1,
      totalPages: 2,
      totalItems: 2,
      nextCursor: "2",
    });
    expect(typeof firstPage.items[0]!.totalAmountMinor).toBe("string");
    const secondPage =
      await scenario.actors.platformAdmin.client.school.listBillingRuns({
        schoolId: scenario.school.id,
        filters: { sessionId: scenario.activeSession.id },
        orderBy: { field: "recordedAt", direction: "asc" },
        cursor: firstPage.pagination.nextCursor!,
        limit: 1,
      });
    expect(secondPage.pagination).toMatchObject({
      currentPage: 2,
      totalPages: 2,
      nextCursor: null,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(typeof secondPage.items[0]!.totalAmountMinor).toBe("string");
    expect(secondPage.items[0]!.id).not.toBe(firstPage.items[0]!.id);
    await expect(
      scenario.actors.outsiderManager.client.school.listBillingRuns({
        schoolId: scenario.school.id,
        orderBy: { field: "recordedAt", direction: "desc" },
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("shows unregistered admissions as excluded from ordinary bulk billing", async () => {
    await db
      .update(admissionTable)
      .set({ registered: false, unregisteredAt: new Date() })
      .where(eq(admissionTable.id, scenario.admission.id));
    const preview = await scenario.actors.accountant.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    expect(preview).toMatchObject({
      readyToPost: false,
      counts: { selected: 1, eligible: 0, skipped: 1 },
    });
    expect(preview.issues.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unregistered", blocking: false }),
      ]),
    );
  });

  it("posts manual bills, rejects unregistered admissions, and preserves snapshots", async () => {
    const input = {
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      admissionId: scenario.admission.id,
      issueDate: "2040-05-12",
      reason: "One-off laboratory charge",
      idempotencyKey: createFinanceIdempotencyKey("manual"),
      lines: [{ title: "Broken laboratory beaker", amountMinor: "2500" }],
    };
    const bill = await scenario.actors.accountant.client.school.createManualBill(input);
    expect(bill).toMatchObject({
      sourceKind: "manual",
      totalAmountMinor: "2500",
      admissionNameSnapshot: scenario.admission.name,
      classLabelSnapshot: scenario.schoolClass.label,
      manualReason: "One-off laboratory charge",
      lines: [
        expect.objectContaining({
          feeElementSlug: "manual-item",
          feeElementName: "Broken laboratory beaker",
          amountMinor: "2500",
        }),
      ],
    });
    await expect(
      scenario.actors.accountant.client.school.createManualBill(input),
    ).resolves.toMatchObject({ id: bill.id });
    await expect(
      scenario.actors.accountant.client.school.createManualBill({
        ...input,
        reason: "Changed payload",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      scenario.actors.accountant.client.school.createManualBill({
        ...input,
        lines: [{ title: "Different item", amountMinor: "2500" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      scenario.actors.accountant.client.school.createManualBill({
        ...input,
        reason: " ",
        idempotencyKey: createFinanceIdempotencyKey("manual-blank-reason"),
      }),
    ).rejects.toBeDefined();
    await scenario.actors.accountant.client.school.reverseBill({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      admissionId: scenario.admission.id,
      billId: bill.id,
      effectiveAt: new Date("2040-05-20T00:00:00.000Z"),
      reason: "Reverse manual bill",
      idempotencyKey: createFinanceIdempotencyKey("manual-reversal"),
    });
    await expect(
      scenario.actors.accountant.client.school.createManualBill(input),
    ).resolves.toMatchObject({ id: bill.id, reversed: true });

    await db
      .update(admissionTable)
      .set({ registered: false, unregisteredAt: new Date() })
      .where(eq(admissionTable.id, scenario.admission.id));
    await expect(
      scenario.actors.accountant.client.school.createManualBill({
        ...input,
        idempotencyKey: createFinanceIdempotencyKey("manual-unregistered"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("preserves cumulative projection totals beyond one operational bigint", async () => {
    const maximum = "9223372036854775807";
    const first = await scenario.actors.accountant.client.school.createManualBill({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      admissionId: scenario.admission.id,
      issueDate: "2040-05-12",
      reason: "Maximum individual posting",
      idempotencyKey: createFinanceIdempotencyKey("projection-max"),
      lines: [{ title: "Maximum charge", amountMinor: maximum }],
    });
    const second = await scenario.actors.accountant.client.school.createManualBill({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      admissionId: scenario.admission.id,
      issueDate: "2040-05-13",
      reason: "Projection exceeds operational bigint",
      idempotencyKey: createFinanceIdempotencyKey("projection-max-plus-one"),
      lines: [{ title: "Additional charge", amountMinor: "1" }],
    });
    expect(first.totalAmountMinor).toBe(maximum);
    expect(second.totalAmountMinor).toBe("1");
    const [balance] = await db
      .select()
      .from(financeAdmissionBalanceTable)
      .where(
        and(
          eq(financeAdmissionBalanceTable.schoolId, scenario.school.id),
          eq(financeAdmissionBalanceTable.admissionId, scenario.admission.id),
          eq(financeAdmissionBalanceTable.currency, "INR"),
        ),
      );
    const [activity] = await db
      .select()
      .from(financeAdmissionSessionActivityTable)
      .where(
        and(
          eq(financeAdmissionSessionActivityTable.schoolId, scenario.school.id),
          eq(
            financeAdmissionSessionActivityTable.admissionId,
            scenario.admission.id,
          ),
          eq(
            financeAdmissionSessionActivityTable.sessionId,
            scenario.activeSession.id,
          ),
          eq(financeAdmissionSessionActivityTable.currency, "INR"),
        ),
      );
    expect(balance?.debitTotalMinor).toBe(BigInt("9223372036854775808"));
    expect(activity?.debitTotalMinor).toBe(BigInt("9223372036854775808"));
    await expect(scenario.actors.platformAdmin.client.school.getAdmissionFinanceSummary({ schoolId: scenario.school.id, admissionId: scenario.admission.id, sessionId: scenario.activeSession.id })).resolves.toMatchObject({ currencies: [expect.objectContaining({ lifetimeDebitMinor: "9223372036854775808", balanceMinor: "9223372036854775808", dueMinor: "9223372036854775808" })] });
    await expect(scenario.actors.platformAdmin.client.school.getAdmissionLedger({ schoolId: scenario.school.id, admissionId: scenario.admission.id, limit: 20 })).resolves.toMatchObject({ closingBalances: [expect.objectContaining({ balanceMinor: "9223372036854775808" })], sessionSummaries: [expect.objectContaining({ debitTotalMinor: "9223372036854775808" })] });
    await expect(scenario.actors.platformAdmin.client.school.reconcileAdmissionProjection({ schoolId: scenario.school.id, admissionId: scenario.admission.id, currency: "INR" })).resolves.toMatchObject({ matches: true, expected: { lifetime: expect.objectContaining({ debitTotalMinor: "9223372036854775808" }) } });
  });

  it("returns non-leaking NOT_FOUND for missing or cross-school finance accounts", async () => {
    const foreignAdmission = await createTestAdmission({
      schoolId: scenario.outsiderSchool.id,
    });
    const manualBase = {
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      issueDate: "2040-05-12",
      reason: "Account ownership test",
      lines: [{ title: "Account ownership charge", amountMinor: "100" }],
    };
    for (const admissionId of [foreignAdmission.id, "missing-admission"]) {
      await expect(
        scenario.actors.manager.client.school.createManualBill({
          ...manualBase,
          admissionId,
          idempotencyKey: createFinanceIdempotencyKey(`manual-${admissionId}`),
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Admission account was not found.",
      });
    }

    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    const run = await scenario.actors.manager.client.school.postBillingRun({
      ...draft(scenario),
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: createFinanceIdempotencyKey("mismatch-source"),
      kind: "regular",
    });
    const detail = await scenario.actors.manager.client.school.getBillingRun({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      billRunId: run.id,
    });
    await expect(
      scenario.actors.manager.client.school.reverseBill({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        admissionId: foreignAdmission.id,
        billId: detail.bills.items[0]!.id,
        effectiveAt: new Date("2040-05-20T00:00:00.000Z"),
        reason: "Mismatched account",
        idempotencyKey: createFinanceIdempotencyKey("mismatch-reversal"),
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Admission account was not found.",
    });
  });

  it("keeps run snapshots stable after placement and pricing changes", async () => {
    const preview = await scenario.actors.principal.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    const run = await scenario.actors.principal.client.school.postBillingRun({
      ...draft(scenario),
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: createFinanceIdempotencyKey("snapshot"),
      kind: "regular",
    });
    await Promise.all([
      db
        .update(classTable)
        .set({ label: "Renamed after billing" })
        .where(eq(classTable.id, scenario.schoolClass.id)),
      db
        .update(schoolSessionTable)
        .set({ financeClassOverrides: { [scenario.schoolClass.slug]: { tuition: 99_999 } } })
        .where(eq(schoolSessionTable.id, scenario.activeSession.id)),
      db
        .update(studentTable)
        .set({ rollNo: 99 })
        .where(eq(studentTable.id, scenario.activeStudent.id)),
    ]);
    const detail = await scenario.actors.platformAdmin.client.school.getBillingRun({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      billRunId: run.id,
    });
    expect(detail.bills.items[0]).toMatchObject({
      admissionNumberSnapshot: scenario.admission.admissionNo,
      admissionNameSnapshot: scenario.admission.name,
      sessionStartYearSnapshot: 2040,
      sessionEndYearSnapshot: 2041,
      enrollmentIdSnapshot: scenario.activeStudent.id,
      classIdSnapshot: scenario.schoolClass.id,
      classSlugSnapshot: scenario.schoolClass.slug,
      classLabelSnapshot: scenario.schoolClass.label,
      sectionIdSnapshot: scenario.section.id,
      sectionSlugSnapshot: scenario.section.slug,
      sectionLabelSnapshot: scenario.section.label,
      rollNumberSnapshot: 1,
      configHash: run.configHash,
      lineCount: 2,
      totalAmountMinor: "12500",
    });
    expect(detail.bills.items[0]?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ feeElementSlug: "tuition", amountMinor: "12000" }),
      ]),
    );
  });

  it("reverses bills and entire runs as opposite immutable facts and updates projections", async () => {
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    const run = await scenario.actors.manager.client.school.postBillingRun({
      ...draft(scenario),
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: createFinanceIdempotencyKey("reverse-source"),
      kind: "regular",
    });
    const detail = await scenario.actors.manager.client.school.getBillingRun({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      billRunId: run.id,
    });
    const bill = detail.bills.items[0]!;
    const reversed = await scenario.actors.accountant.client.school.reverseBill({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      admissionId: scenario.admission.id,
      billId: bill.id,
      effectiveAt: new Date("2040-05-20T00:00:00.000Z"),
      reason: "Bill posted in error",
      idempotencyKey: createFinanceIdempotencyKey("reverse-bill"),
    });
    expect(reversed).toMatchObject({ billId: bill.id, amountMinor: "12500" });
    const [balance] = await db
      .select()
      .from(financeAdmissionBalanceTable)
      .where(
        and(
          eq(financeAdmissionBalanceTable.schoolId, scenario.school.id),
          eq(financeAdmissionBalanceTable.admissionId, scenario.admission.id),
          eq(financeAdmissionBalanceTable.currency, "INR"),
        ),
      );
    expect(balance).toMatchObject({
      debitTotalMinor: 12_500n,
      creditTotalMinor: 12_500n,
      lastSequence: 2n,
    });
    await expect(
      scenario.actors.accountant.client.school.reverseBillingRun({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        billRunId: run.id,
        effectiveAt: new Date("2040-05-21T00:00:00.000Z"),
        reason: "Reverse whole run",
        idempotencyKey: createFinanceIdempotencyKey("reverse-run"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects one bill and its multi-member run atomically while one allocation is live", async () => {
    const secondAdmission = await createTestAdmission({ schoolId: scenario.school.id });
    await Promise.all([
      db
        .update(admissionTable)
        .set({ financeValue: { [scenario.activeSession.id]: { transport: 700 } } })
        .where(eq(admissionTable.id, secondAdmission.id)),
      createTestStudent({
        schoolId: scenario.school.id,
        admissionId: secondAdmission.id,
        sessionId: scenario.activeSession.id,
        classId: scenario.schoolClass.id,
        sectionId: scenario.section.id,
        rollNo: 2,
      }),
    ]);
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    const run = await scenario.actors.manager.client.school.postBillingRun({
      ...draft(scenario),
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: createFinanceIdempotencyKey("settled-source"),
      kind: "regular",
    });
    const detail = await scenario.actors.manager.client.school.getBillingRun({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      billRunId: run.id,
    });
    expect(detail.bills.items).toHaveLength(2);
    const bill = detail.bills.items.find(
      ({ admissionId }) => admissionId === scenario.admission.id,
    )!;
    const [paymentLedger] = await db
      .insert(financeLedgerEntryTable)
      .values({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        sequence: BigInt(2),
        type: "payment",
        direction: "credit",
        amountMinor: BigInt(1_000),
        currency: "INR",
        effectiveAt: new Date("2040-05-15T00:00:00.000Z"),
        recordedBy: scenario.actors.manager.session.user.id,
        idempotencyKey: createFinanceIdempotencyKey("settlement-ledger"),
      })
      .returning();
    const [payment] = await db
      .insert(financePaymentTable)
      .values({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
        sessionId: scenario.activeSession.id,
        ledgerEntryId: paymentLedger!.id,
        receiptNumber: `RCP/test/${createFinanceIdempotencyKey("receipt")}`,
        amountMinor: BigInt(1_000),
        currency: "INR",
        method: "cash",
        receivedAt: new Date("2040-05-15T00:00:00.000Z"),
        idempotencyKey: createFinanceIdempotencyKey("settlement-payment"),
        commandHash: "a".repeat(64),
        commandSnapshot: { test: true },
        recordedBy: scenario.actors.manager.session.user.id,
      })
      .returning();
    await db.insert(financePaymentAllocationTable).values({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      paymentId: payment!.id,
      billId: bill.id,
      amountMinor: BigInt(1_000),
      currency: "INR",
    });
    await expect(
      scenario.actors.accountant.client.school.reverseBill({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        admissionId: scenario.admission.id,
        billId: bill.id,
        effectiveAt: new Date("2040-05-20T00:00:00.000Z"),
        reason: "Cannot reverse a settled bill",
        idempotencyKey: createFinanceIdempotencyKey("settled-reversal"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      scenario.actors.accountant.client.school.reverseBillingRun({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        billRunId: run.id,
        effectiveAt: new Date("2040-05-20T00:00:00.000Z"),
        reason: "One member is settled",
        idempotencyKey: createFinanceIdempotencyKey("settled-run-reversal"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [reversalCount] = await db
      .select({ value: count() })
      .from(financeLedgerEntryTable)
      .where(
        and(
          eq(financeLedgerEntryTable.schoolId, scenario.school.id),
          eq(financeLedgerEntryTable.type, "reversal"),
        ),
      );
    expect(reversalCount?.value).toBe(0);
  });

  it("reverses every member of a run atomically and makes exact retries idempotent", async () => {
    const secondAdmission = await createTestAdmission({ schoolId: scenario.school.id });
    await Promise.all([
      db
        .update(admissionTable)
        .set({ financeValue: { [scenario.activeSession.id]: { transport: 700 } } })
        .where(eq(admissionTable.id, secondAdmission.id)),
      createTestStudent({
        schoolId: scenario.school.id,
        admissionId: secondAdmission.id,
        sessionId: scenario.activeSession.id,
        classId: scenario.schoolClass.id,
        sectionId: scenario.section.id,
        rollNo: 2,
      }),
    ]);
    const preview = await scenario.actors.accountant.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    expect(preview.counts.eligible).toBe(2);
    const runKey = createFinanceIdempotencyKey("multi-run");
    const run = await scenario.actors.accountant.client.school.postBillingRun({
      ...draft(scenario),
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: runKey,
      kind: "regular",
    });
    const reversalInput = {
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      billRunId: run.id,
      effectiveAt: new Date("2040-05-20T00:00:00.000Z"),
      reason: "Entire run posted in error",
      idempotencyKey: createFinanceIdempotencyKey("multi-run-reversal"),
    };
    const reversed =
      await scenario.actors.accountant.client.school.reverseBillingRun(
        reversalInput,
      );
    expect(reversed).toMatchObject({
      reversedBillCount: 2,
      totalAmountMinor: "25200",
      currency: "INR",
    });
    await expect(
      scenario.actors.accountant.client.school.reverseBillingRun(reversalInput),
    ).resolves.toEqual(reversed);
    const detail = await scenario.actors.platformAdmin.client.school.getBillingRun({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      billRunId: run.id,
      page: 1,
      limit: 1,
    });
    expect(detail).toMatchObject({ reversedBillCount: 2, fullyReversed: true });
    expect(detail.bills.items.every(({ reversed: value }) => value)).toBe(true);
    expect(detail.bills.pagination).toMatchObject({
      currentPage: 1,
      totalPages: 2,
      totalItems: 2,
      pageSize: 1,
      nextCursor: "2",
    });
    expect(typeof detail.bills.items[0]!.totalAmountMinor).toBe("string");
    expect(
      detail.bills.items[0]!.lines.every(
        ({ amountMinor }) => typeof amountMinor === "string",
      ),
    ).toBe(true);
    const pageTwo = await scenario.actors.platformAdmin.client.school.getBillingRun({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      billRunId: run.id,
      page: 2,
      limit: 1,
    });
    expect(pageTwo.bills.pagination).toMatchObject({
      currentPage: 2,
      nextCursor: null,
    });
    expect(pageTwo.bills.items).toHaveLength(1);
    await expect(
      scenario.actors.accountant.client.school.postBillingRun({
        ...draft(scenario),
        expectedConfigurationHash: preview.configurationHash,
        idempotencyKey: runKey,
        kind: "regular",
      }),
    ).resolves.toMatchObject({ reversedBillCount: 2, fullyReversed: true });
  });

  it("namespaces standalone reversals and rejects partial run-reversal adoption", async () => {
    const secondAdmission = await createTestAdmission({ schoolId: scenario.school.id });
    await Promise.all([
      db
        .update(admissionTable)
        .set({ financeValue: { [scenario.activeSession.id]: { transport: 700 } } })
        .where(eq(admissionTable.id, secondAdmission.id)),
      createTestStudent({
        schoolId: scenario.school.id,
        admissionId: secondAdmission.id,
        sessionId: scenario.activeSession.id,
        classId: scenario.schoolClass.id,
        sectionId: scenario.section.id,
        rollNo: 2,
      }),
    ]);
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    const run = await scenario.actors.manager.client.school.postBillingRun({
      ...draft(scenario),
      expectedConfigurationHash: preview.configurationHash,
      idempotencyKey: createFinanceIdempotencyKey("namespace-source"),
      kind: "regular",
    });
    const detail = await scenario.actors.manager.client.school.getBillingRun({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      billRunId: run.id,
      limit: 20,
    });
    const [firstBill, secondBill] = detail.bills.items;
    const sharedLogicalKey = createFinanceIdempotencyKey("shared-reversal-key");
    await scenario.actors.manager.client.school.reverseBill({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      admissionId: firstBill!.admissionId,
      billId: firstBill!.id,
      effectiveAt: new Date("2040-05-20T00:00:00.000Z"),
      reason: "Independent correction",
      idempotencyKey: sharedLogicalKey,
    });
    await expect(
      scenario.actors.manager.client.school.reverseBillingRun({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        billRunId: run.id,
        effectiveAt: new Date("2040-05-20T00:00:00.000Z"),
        reason: "Independent correction",
        idempotencyKey: sharedLogicalKey,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [standalone] = await db
      .select({ idempotencyKey: financeLedgerEntryTable.idempotencyKey })
      .from(financeLedgerEntryTable)
      .where(
        and(
          eq(financeLedgerEntryTable.schoolId, scenario.school.id),
          eq(financeLedgerEntryTable.reversalOfEntryId, firstBill!.ledgerEntryId),
        ),
      );
    expect(standalone!.idempotencyKey).toBe(
      `bill-reversal:${sharedLogicalKey}`,
    );

    const supplemental =
      await scenario.actors.manager.client.school.postBillingRun({
        ...draft(scenario),
        expectedConfigurationHash: preview.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("partial-source"),
        kind: "supplemental",
        supplementalReason: "Prepare partial reversal coverage",
      });
    const supplementalDetail =
      await scenario.actors.manager.client.school.getBillingRun({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        billRunId: supplemental.id,
        limit: 20,
      });
    const supplementalSecondBill = supplementalDetail.bills.items.find(
      ({ admissionId }) => admissionId === secondBill!.admissionId,
    )!;
    const partialKey = createFinanceIdempotencyKey("partial-run-reversal");
    await db.insert(financeLedgerEntryTable).values({
      schoolId: scenario.school.id,
      admissionId: supplementalSecondBill.admissionId,
      sessionId: scenario.activeSession.id,
      sequence: BigInt(3),
      type: "reversal",
      direction: "credit",
      amountMinor: BigInt(supplementalSecondBill.totalAmountMinor),
      currency: supplementalSecondBill.currency,
      effectiveAt: new Date("2040-05-21T00:00:00.000Z"),
      recordedBy: scenario.actors.manager.session.user.id,
      note: "Partial injected run reversal",
      reversalOfEntryId: supplementalSecondBill.ledgerEntryId,
      idempotencyKey: `run-reversal:${supplemental.id}:${partialKey}:${supplementalSecondBill.id}`,
    });
    await expect(
      scenario.actors.manager.client.school.reverseBillingRun({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        billRunId: supplemental.id,
        effectiveAt: new Date("2040-05-21T00:00:00.000Z"),
        reason: "Partial injected run reversal",
        idempotencyKey: partialKey,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const reversals = await db
      .select({ id: financeLedgerEntryTable.id })
      .from(financeLedgerEntryTable)
      .where(
        and(
          eq(financeLedgerEntryTable.schoolId, scenario.school.id),
          eq(financeLedgerEntryTable.type, "reversal"),
        ),
      );
    expect(reversals).toHaveLength(2);
  });

  it("rolls back run, bill, ledger, projection, and counter writes on a real constraint failure", async () => {
    await scenario.actors.accountant.client.school.createManualBill({
      schoolId: scenario.school.id,
      sessionId: scenario.activeSession.id,
      admissionId: scenario.admission.id,
      issueDate: "2040-05-01",
      reason: "Seed first bill number",
      idempotencyKey: createFinanceIdempotencyKey("rollback-seed"),
      lines: [{ title: "Seed charge", amountMinor: "100" }],
    });
    await db
      .update(financeNumberCounterTable)
      .set({ nextValue: 1n })
      .where(
        and(
          eq(financeNumberCounterTable.schoolId, scenario.school.id),
          eq(financeNumberCounterTable.sessionId, scenario.activeSession.id),
          eq(financeNumberCounterTable.kind, "bill"),
        ),
      );
    const preview = await scenario.actors.manager.client.school.previewBillingRun({
      ...draft(scenario),
      page: 1,
      limit: 20,
    });
    await expect(
      scenario.actors.manager.client.school.postBillingRun({
        ...draft(scenario),
        expectedConfigurationHash: preview.configurationHash,
        idempotencyKey: createFinanceIdempotencyKey("rollback-run"),
        kind: "regular",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [runs, bills, entries, balance, counter] = await Promise.all([
      db.select({ value: count() }).from(financeBillRunTable).where(eq(financeBillRunTable.schoolId, scenario.school.id)),
      db.select({ value: count() }).from(financeBillTable).where(eq(financeBillTable.schoolId, scenario.school.id)),
      db.select({ value: count() }).from(financeLedgerEntryTable).where(eq(financeLedgerEntryTable.schoolId, scenario.school.id)),
      db.select().from(financeAdmissionBalanceTable).where(and(eq(financeAdmissionBalanceTable.schoolId, scenario.school.id), eq(financeAdmissionBalanceTable.admissionId, scenario.admission.id))),
      db.select().from(financeNumberCounterTable).where(and(eq(financeNumberCounterTable.schoolId, scenario.school.id), eq(financeNumberCounterTable.sessionId, scenario.activeSession.id), eq(financeNumberCounterTable.kind, "bill"))),
    ]);
    expect(runs[0]?.value).toBe(0);
    expect(bills[0]?.value).toBe(1);
    expect(entries[0]?.value).toBe(1);
    expect(balance[0]).toMatchObject({ debitTotalMinor: 100n, creditTotalMinor: 0n, lastSequence: 1n });
    expect(counter[0]?.nextValue).toBe(1n);
  });

  it.each(["projection", "line", "finalization"] as const)(
    "rolls back every multi-member fact after a scoped %s-stage failure",
    async (stage) => {
      const secondAdmission = await createTestAdmission({ schoolId: scenario.school.id });
      await Promise.all([
        db
          .update(admissionTable)
          .set({ financeValue: { [scenario.activeSession.id]: { transport: 700 } } })
          .where(eq(admissionTable.id, secondAdmission.id)),
        createTestStudent({
          schoolId: scenario.school.id,
          admissionId: secondAdmission.id,
          sessionId: scenario.activeSession.id,
          classId: scenario.schoolClass.id,
          sectionId: scenario.section.id,
          rollNo: 2,
        }),
      ]);
      const preview = await scenario.actors.manager.client.school.previewBillingRun({
        ...draft(scenario),
        page: 1,
        limit: 20,
      });
      const removeTrigger = await installScopedFailureTrigger(
        stage,
        scenario.school.id,
      );
      try {
        await expect(
          scenario.actors.manager.client.school.postBillingRun({
            ...draft(scenario),
            expectedConfigurationHash: preview.configurationHash,
            idempotencyKey: createFinanceIdempotencyKey(`rollback-${stage}`),
            kind: "regular",
          }),
        ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      } finally {
        await removeTrigger();
      }
      const [runs, bills, lines, entries, balances, counters] = await Promise.all([
        db.select({ value: count() }).from(financeBillRunTable).where(eq(financeBillRunTable.schoolId, scenario.school.id)),
        db.select({ value: count() }).from(financeBillTable).where(eq(financeBillTable.schoolId, scenario.school.id)),
        db.select({ value: count() }).from(financeBillLineTable).where(eq(financeBillLineTable.schoolId, scenario.school.id)),
        db.select({ value: count() }).from(financeLedgerEntryTable).where(eq(financeLedgerEntryTable.schoolId, scenario.school.id)),
        db.select({ value: count() }).from(financeAdmissionBalanceTable).where(eq(financeAdmissionBalanceTable.schoolId, scenario.school.id)),
        db.select({ value: count() }).from(financeNumberCounterTable).where(eq(financeNumberCounterTable.schoolId, scenario.school.id)),
      ]);
      expect([runs, bills, lines, entries, balances, counters].map((rows) => rows[0]?.value)).toEqual([0, 0, 0, 0, 0, 0]);
    },
  );
});
