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

function formatFinanceNumber(
  kind: FinanceNumberKind,
  fiscalKey: string,
  sequence: bigint,
): { number: string; sequence: string } {
  return {
    number: `${PREFIX[kind]}/${fiscalKey}/${sequence
      .toString(10)
      .padStart(6, "0")}`,
    sequence: sequence.toString(10),
  };
}

/** Reserves a contiguous number block with one counter transition. */
export async function reserveFinanceNumbers(
  transaction: DatabaseTransaction,
  input: {
    schoolId: string;
    sessionId: string;
    kind: FinanceNumberKind;
    count: number;
  },
): Promise<Array<{ number: string; sequence: string }>> {
  if (!Number.isSafeInteger(input.count) || input.count < 1) {
    throw new Error("Finance number reservation count must be positive");
  }
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
    .values({
      schoolId: input.schoolId,
      sessionId: input.sessionId,
      kind: input.kind,
      fiscalKey,
      nextValue: BigInt(1),
    })
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
  const start = counter.nextValue;
  await transaction
    .update(financeNumberCounterTable)
    .set({ nextValue: start + BigInt(input.count), updatedAt: new Date() })
    .where(
      and(
        eq(financeNumberCounterTable.schoolId, input.schoolId),
        eq(financeNumberCounterTable.sessionId, input.sessionId),
        eq(financeNumberCounterTable.kind, input.kind),
      ),
    );
  return Array.from({ length: input.count }, (_, index) =>
    formatFinanceNumber(input.kind, fiscalKey, start + BigInt(index)),
  );
}

/** Allocates one human number under a serialized per-session counter row. */
export async function allocateFinanceNumber(
  transaction: DatabaseTransaction,
  input: {
    schoolId: string;
    sessionId: string;
    kind: FinanceNumberKind;
  },
): Promise<{ number: string; sequence: string }> {
  const [number] = await reserveFinanceNumbers(transaction, {
    ...input,
    count: 1,
  });
  if (!number) throw new Error("Finance number was not reserved");
  return number;
}
