import type { DatabaseTransaction } from "@campuspilot/db";
import { financeNumberCounterTable } from "@campuspilot/db/schema/finance";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { and, eq } from "drizzle-orm";

type FinanceNumberKind = "bill" | "receipt" | "refund";

const PREFIX: Record<FinanceNumberKind, string> = {
  bill: "BILL",
  receipt: "RCP",
  refund: "RFN",
};

/** Allocates one human number under a serialized per-session counter row. */
export async function allocateFinanceNumber(
  transaction: DatabaseTransaction,
  input: {
    schoolId: string;
    sessionId: string;
    kind: FinanceNumberKind;
  },
): Promise<{ number: string; sequence: string }> {
  const [session] = await transaction
    .select({
      startYear: schoolSessionTable.sessionStartYear,
      endYear: schoolSessionTable.sessionEndYear,
    })
    .from(schoolSessionTable)
    .where(
      and(
        eq(schoolSessionTable.id, input.sessionId),
        eq(schoolSessionTable.schoolId, input.schoolId),
      ),
    )
    .for("update")
    .limit(1);
  if (!session) throw new Error("Finance numbering session was not found");
  const fiscalKey = `${session.startYear}-${session.endYear}`;
  await transaction
    .insert(financeNumberCounterTable)
    .values({ ...input, fiscalKey, nextValue: 1n })
    .onConflictDoNothing();
  const [counter] = await transaction
    .select()
    .from(financeNumberCounterTable)
    .where(
      and(
        eq(financeNumberCounterTable.schoolId, input.schoolId),
        eq(financeNumberCounterTable.sessionId, input.sessionId),
        eq(financeNumberCounterTable.kind, input.kind),
      ),
    )
    .for("update")
    .limit(1);
  if (!counter) throw new Error("Finance number counter was not created");
  if (counter.fiscalKey !== fiscalKey) {
    throw new Error("Finance counter fiscal key does not match the session");
  }

  const sequence = counter.nextValue;
  await transaction
    .update(financeNumberCounterTable)
    .set({ nextValue: sequence + 1n, updatedAt: new Date() })
    .where(
      and(
        eq(financeNumberCounterTable.schoolId, input.schoolId),
        eq(financeNumberCounterTable.sessionId, input.sessionId),
        eq(financeNumberCounterTable.kind, input.kind),
      ),
    );
  return {
    number: `${PREFIX[input.kind]}/${fiscalKey}/${sequence
      .toString(10)
      .padStart(6, "0")}`,
    sequence: sequence.toString(10),
  };
}
