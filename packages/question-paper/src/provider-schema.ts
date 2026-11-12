import { z } from "zod";

import { questionPaper } from "./schema";

/**
 * JSON Schema keywords that the providers' structured-output modes reject or
 * ignore. The Zod schema re-validates all of them server side, so dropping
 * them here only weakens the model-facing hint, never the stored data.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "multipleOf",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
]);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
        .map(([key, item]) => [key, strip(item)]),
    );
  }
  return value;
}

let cached: Record<string, unknown> | undefined;

/**
 * The model-facing JSON Schema of the paper. Advisory shape plus the
 * structured-output guarantee of valid JSON: the Zod schema is the authority.
 * Depth is explicit in the Zod schema, so the result has no `$ref`
 * recursion. The same schema is returned by the learn tool, so the worker and
 * chat agents produce one shape.
 */
export function questionPaperProviderJsonSchema(): Record<string, unknown> {
  cached ??= strip(
    z.toJSONSchema(questionPaper, {
      io: "input",
      target: "draft-2020-12",
      unrepresentable: "any",
    }),
  ) as Record<string, unknown>;
  return cached;
}
