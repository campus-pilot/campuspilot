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
 *
 * Shared sub-schemas (rich text, blocks, questions) are emitted once under
 * `$defs` and referenced with `$ref` (`reused: "ref"`): inlined, the schema is
 * 77 KB (about 20k tokens, on every generation request and in the learn
 * tool); with `$defs` it is about 7 KB. Both providers accept this: the
 * Anthropic SDK's own schema transform keeps `$defs`/`$ref`, and the Gemini
 * `responseJsonSchema` typings list `$defs` and `$ref` as supported (see
 * `docs/assistant.md`). Depth is explicit in the Zod schema, so the
 * references are never recursive (a test walks the reference graph for
 * cycles), which neither provider supports. The same schema is returned by
 * the learn tool, so the worker and chat agents produce one shape.
 */
export function questionPaperProviderJsonSchema(): Record<string, unknown> {
  cached ??= strip(
    z.toJSONSchema(questionPaper, {
      io: "input",
      target: "draft-2020-12",
      unrepresentable: "any",
      reused: "ref",
    }),
  ) as Record<string, unknown>;
  return cached;
}
