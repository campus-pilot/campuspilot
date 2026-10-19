import { z } from "zod";

export const financeIntegerStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "Expected a non-negative base-10 integer string");

/** JSON-safe wire representation for PostgreSQL bigint finance values. */
export function serializeFinanceInteger(value: bigint): string {
  if (value < 0n) throw new Error("Finance integer cannot be negative");
  return value.toString(10);
}

/** Parses an API finance integer without passing through JavaScript number. */
export function parseFinanceInteger(value: string): bigint {
  return BigInt(financeIntegerStringSchema.parse(value));
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
