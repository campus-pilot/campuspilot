import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { and, asc, eq, inArray } from "drizzle-orm";

import { rpcError } from "../../../errors";

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
  if (!account) throw rpcError.notFound("Admission account");
}

/** Locks a bounded account set in canonical admission-id order in one query. */
export async function lockFinanceAdmissionAccounts(
  db: DatabaseExecutor,
  schoolId: string,
  admissionIds: string[],
): Promise<void> {
  const ids = [...new Set(admissionIds)].sort();
  if (!ids.length) return;
  const accounts = await db
    .select({ id: admissionTable.id })
    .from(admissionTable)
    .where(
      and(
        eq(admissionTable.schoolId, schoolId),
        inArray(admissionTable.id, ids),
      ),
    )
    .orderBy(asc(admissionTable.id))
    .for("update");
  if (accounts.length !== ids.length) throw rpcError.notFound("Admission account");
}
