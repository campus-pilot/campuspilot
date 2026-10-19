import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, inject, it } from "vitest";

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../db/src/migrations",
);
const createdDatabases: string[] = [];

function databaseUrl(name: string) {
  const url = new URL(inject("DATABASE_URL"));
  url.pathname = `/${name}`;
  return url.toString();
}

async function adminClient() {
  const client = new pg.Client({ connectionString: inject("DATABASE_URL") });
  await client.connect();
  return client;
}

async function executeMigration(client: pg.Client, file: string) {
  const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

async function createVersion17Database() {
  const name = `finance_upgrade_${randomUUID().replaceAll("-", "")}`;
  const admin = await adminClient();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  createdDatabases.push(name);
  const client = new pg.Client({ connectionString: databaseUrl(name) });
  await client.connect();
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{4}.*\.sql$/.test(file) && Number(file.slice(0, 4)) <= 17)
    .toSorted();
  for (const file of files) await executeMigration(client, file);
  return client;
}

async function seedSchool(client: pg.Client, suffix: string) {
  const schoolId = `school-${suffix}`;
  await client.query(
    `INSERT INTO school (id, slug, name, location) VALUES ($1, $2, $3, 'Test')`,
    [schoolId, `school-${suffix}`, `School ${suffix}`],
  );
  return schoolId;
}

async function seedSession(
  client: pg.Client,
  schoolId: string,
  id: string,
  financeConfig: object,
  classOverrides: object = {},
  startYear = 2040,
) {
  await client.query(
    `INSERT INTO school_session
      (id, school_id, session_start_year, session_end_year, finance_config, finance_class_overrides)
     VALUES ($1, $2, $5, $5 + 1, $3::jsonb, $4::jsonb)`,
    [id, schoolId, JSON.stringify(financeConfig), JSON.stringify(classOverrides), startYear],
  );
}

async function seedAdmission(
  client: pg.Client,
  schoolId: string,
  id: string,
  admissionNo: string,
  financeConfig: object = {},
) {
  await client.query(
    `INSERT INTO admission
      (id, school_id, name, admission_no, address, phone_no, dob, father_name, mother_name, finance_config)
     VALUES ($1, $2, 'Student', $3, 'Address', '1', '2010-01-01', 'Father', 'Mother', $4::jsonb)`,
    [id, schoolId, admissionNo, JSON.stringify(financeConfig)],
  );
}

afterEach(async () => {
  const names = createdDatabases.splice(0);
  if (names.length === 0) return;
  const admin = await adminClient();
  for (const name of names) {
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.end();
});

describe("finance 0017 to 0018 upgrade", () => {
  it("converts base, class, and admission amounts at reviewed 0/2/3/4 exponents without inventing period facts", async () => {
    const client = await createVersion17Database();
    const schoolId = await seedSchool(client, "success");
    const cases = [
      ["JPY", 123, 123],
      ["INR", 123.45, 12_345],
      ["KWD", 123.456, 123_456],
      ["CLF", 123.4567, 1_234_567],
    ] as const;
    for (const [index, [currency, major]] of cases.entries()) {
      const sessionId = `session-${index}`;
      await seedSession(
        client,
        schoolId,
        sessionId,
        {
          recurring: "monthly",
          currency,
          elements: {
            tuition: {
              name: "Tuition",
              scopes: ["school", "class", "student"],
              requiredAtLevel: "school",
              defaultValue: major,
            },
          },
        },
        { grade: { tuition: major } },
        2040 + index,
      );
      await seedAdmission(client, schoolId, `admission-${index}`, `A-${index}`, {
        [sessionId]: { tuition: major },
      });
    }
    await executeMigration(client, "0018_finance-foundation.sql");

    const sessions = await client.query(
      `SELECT id, finance_config, finance_class_overrides FROM school_session ORDER BY id`,
    );
    const admissions = await client.query(
      `SELECT finance_config FROM admission ORDER BY id`,
    );
    for (const [index, [, , minor]] of cases.entries()) {
      expect(sessions.rows[index].finance_config).not.toHaveProperty("timeZone");
      expect(sessions.rows[index].finance_config).not.toHaveProperty("cycleStartMonth");
      expect(sessions.rows[index].finance_config.elements.tuition).toMatchObject({
        defaultAmountMinor: minor,
      });
      expect(sessions.rows[index].finance_class_overrides.grade.tuition).toBe(minor);
      expect(admissions.rows[index].finance_config[`session-${index}`].tuition).toBe(minor);
    }
    await client.end();
  });

  it.each([
    ["unsupported explicit currency", { recurring: "monthly", currency: "ZZZ", elements: {} }, "A"],
    ["missing currency", { recurring: "monthly", elements: { fee: { name: "Fee", scopes: ["school"], requiredAtLevel: "school", defaultValue: 1 } } }, "A"],
    ["fractional minor", { recurring: "monthly", currency: "JPY", elements: { fee: { name: "Fee", scopes: ["school"], requiredAtLevel: "school", defaultValue: 1.5 } } }, "A"],
    ["overflow", { recurring: "monthly", currency: "INR", elements: { fee: { name: "Fee", scopes: ["school"], requiredAtLevel: "school", defaultValue: 90071992547409.92 } } }, "A"],
  ])("aborts atomically for %s", async (_name, config, admissionNo) => {
    const client = await createVersion17Database();
    const schoolId = await seedSchool(client, randomUUID());
    await seedSession(client, schoolId, "session", config);
    await seedAdmission(client, schoolId, "admission", admissionNo);
    await client.query("BEGIN");
    await expect(executeMigration(client, "0018_finance-foundation.sql")).rejects.toThrow();
    await client.query("ROLLBACK");
    const state = await client.query(
      `SELECT to_regclass('finance_ledger_entry') AS ledger,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'admission' AND column_name = 'unregistered_at'
        ) AS has_unregistered_at`,
    );
    expect(state.rows[0]).toEqual({ ledger: null, has_unregistered_at: false });
    await client.end();
  });

  it.each(["duplicate admission numbers", "orphan admission overrides"])(
    "aborts atomically for %s",
    async (failure) => {
      const client = await createVersion17Database();
      const schoolId = await seedSchool(client, randomUUID());
      await seedSession(client, schoolId, "session", {
        recurring: "monthly",
        currency: "INR",
        elements: {},
      });
      await seedAdmission(
        client,
        schoolId,
        "admission-1",
        "DUP",
        failure === "orphan admission overrides"
          ? { missingSession: { fee: 1 } }
          : {},
      );
      if (failure === "duplicate admission numbers") {
        await seedAdmission(client, schoolId, "admission-2", "DUP");
      }
      await client.query("BEGIN");
      await expect(
        executeMigration(client, "0018_finance-foundation.sql"),
      ).rejects.toThrow();
      await client.query("ROLLBACK");
      const state = await client.query(
        `SELECT to_regclass('finance_ledger_entry') AS ledger`,
      );
      expect(state.rows[0].ledger).toBeNull();
      await client.end();
    },
  );
});
