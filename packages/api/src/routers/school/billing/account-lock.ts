import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { and, eq } from "drizzle-orm";

/**
 * Canonical account lock for all finance posters and projection rebuilds.
 * Callers must lock the session first when an operation also locks a session,
 * then lock admissions in deterministic ID order to avoid deadlocks.
 */
export async function lockFinanceAdmissionAccount(
  db: DatabaseExecutor,
  schoolId: string,
  admissionId: string,
): Promise<void> {
  const [account] = await db
    .select({ id: admissionTable.id })
    .from(admissionTable)
    .where(
      and(
        eq(admissionTable.schoolId, schoolId),
        eq(admissionTable.id, admissionId),
      ),
    )
    .for("update")
    .limit(1);
  if (!account) throw new Error("Finance admission account was not found");
}
