import { z } from "zod";

export const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");

export const financeIntegerStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "Expected a non-negative base-10 integer string")
  .refine(
    (value) => BigInt(value) <= POSTGRES_BIGINT_MAX,
    "Finance integer exceeds the PostgreSQL bigint range",
  );

/** JSON-safe wire representation for PostgreSQL bigint finance values. */
export function serializeFinanceInteger(value: bigint): string {
  if (value < BigInt(0)) throw new Error("Finance integer cannot be negative");
  return value.toString(10);
}

/** Parses an API finance integer without passing through JavaScript number. */
export function parseFinanceInteger(value: string): bigint {
  return BigInt(financeIntegerStringSchema.parse(value));
}

/** Adds non-negative PostgreSQL bigint amounts without permitting overflow. */
export function checkedFinanceAddition(left: bigint, right: bigint): bigint {
  if (left < BigInt(0) || right < BigInt(0) || left > POSTGRES_BIGINT_MAX - right) {
    throw new RangeError("Finance amount exceeds the PostgreSQL bigint range.");
  }
  return left + right;
}

export type ProjectionTotalsTransport = {
  lastSequence: string;
  entryCount: string;
  debitTotalMinor: string;
  creditTotalMinor: string;
};

export function serializeProjectionTotals(value: {
  lastSequence: bigint;
  entryCount: bigint;
  debitTotalMinor: bigint;
  creditTotalMinor: bigint;
}): ProjectionTotalsTransport {
  return {
    lastSequence: serializeFinanceInteger(value.lastSequence),
    entryCount: serializeFinanceInteger(value.entryCount),
    debitTotalMinor: serializeFinanceInteger(value.debitTotalMinor),
    creditTotalMinor: serializeFinanceInteger(value.creditTotalMinor),
  };
}
