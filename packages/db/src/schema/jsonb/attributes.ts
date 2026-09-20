import { z } from "zod";

export const attributesSchema = z
  .record(z.string(), z.unknown())
  .default({})
  .describe("Extensible resource attributes keyed by attribute name");

export type Attributes = z.infer<typeof attributesSchema>;
