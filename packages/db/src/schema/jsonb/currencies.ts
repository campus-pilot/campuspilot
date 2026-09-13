import { z } from "zod";

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Currency must be a three-letter ISO 4217 code")
  .describe("Three-letter ISO 4217 currency code");

export type CurrencyCode = z.infer<typeof currencyCodeSchema>;
