import { describe, expect, it } from "vitest";

import { buildLearnPayload, QUESTION_PAPER_GUIDE } from "./guide";
import { QUESTION_PAPER_EXAMPLES } from "./examples";
import { questionPaperProviderJsonSchema } from "./provider-schema";
import { questionPaper } from "./schema";

const BOUND_KEYWORDS = [
  "multipleOf",
  "pattern",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "$schema",
];

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      keysOf(item, into);
    }
  }
  return into;
}

describe("questionPaperProviderJsonSchema", () => {
  const schema = questionPaperProviderJsonSchema();

  it("has none of the bound keywords providers reject", () => {
    const keys = keysOf(schema);
    for (const keyword of BOUND_KEYWORDS) expect(keys.has(keyword)).toBe(false);
  });

  it("shares sub-schemas through $defs, which keeps it small", () => {
    expect(Object.keys(schema.$defs as object).length).toBeGreaterThan(5);
    expect(JSON.stringify(schema).length).toBeLessThan(15_000);
  });

  it("has only local references, none beside sibling keywords, and no reference cycle", () => {
    const defs = schema.$defs as Record<string, unknown>;
    const referencesOf = (value: unknown, found: string[] = []): string[] => {
      if (Array.isArray(value)) value.forEach((item) => referencesOf(item, found));
      else if (value && typeof value === "object") {
        const node = value as Record<string, unknown>;
        if (typeof node.$ref === "string") {
          found.push(node.$ref);
          expect(Object.keys(node)).toEqual(["$ref"]);
        }
        Object.values(node).forEach((item) => referencesOf(item, found));
      }
      return found;
    };
    const graph = new Map(Object.entries(defs).map(([name, def]) => [`#/$defs/${name}`, referencesOf(def)]));
    for (const reference of [...referencesOf(schema), ...[...graph.values()].flat()]) {
      expect(graph.has(reference)).toBe(true);
    }
    const state = new Map<string, "visiting" | "done">();
    const visit = (name: string) => {
      state.set(name, "visiting");
      for (const next of graph.get(name) ?? []) {
        expect(state.get(next)).not.toBe("visiting");
        if (!state.has(next)) visit(next);
      }
      state.set(name, "done");
    };
    for (const name of graph.keys()) if (!state.has(name)) visit(name);
  });

  it("keeps strictness and descriptions-free structure for the model", () => {
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining(["schemaVersion", "meta", "sections"]),
    );
  });

  it("shows rich text as one flat run object, not a union of run shapes", () => {
    // The first real Gemini call was refused (400 INVALID_ARGUMENT) because the
    // expanded schema was too deep and too large; the union of run shapes with
    // enumerated languages was most of it.
    const text = Object.values(schema.$defs as Record<string, any>).find(
      (def) => Array.isArray(def.anyOf) && def.anyOf[0]?.type === "string" && def.anyOf[1]?.type === "array",
    );
    const run = text.anyOf[1].items;
    expect(Object.keys(run.properties)).toEqual(
      expect.arrayContaining(["t", "v", "tex", "display", "b", "i", "u", "sup", "sub"]),
    );
    expect(run.required).toEqual(["t"]);
    expect(keysOf(text).has("oneOf")).toBe(false);
  });

  it("is memoised and plain JSON", () => {
    expect(questionPaperProviderJsonSchema()).toBe(schema);
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});

describe("learn payload", () => {
  it("carries the guide, schema, limits and two valid examples", () => {
    const payload = buildLearnPayload();
    expect(payload.schemaVersion).toBe(1);
    expect(payload.examples).toHaveLength(2);
    for (const example of payload.examples) {
      expect(questionPaper.safeParse(example).success).toBe(true);
    }
    expect(payload.limits.sections).toBe(20);
    expect(payload.guide).toBe(QUESTION_PAPER_GUIDE);
    expect(QUESTION_PAPER_EXAMPLES).toHaveLength(2);
  });

  it("tells agents the rules that protect the user", () => {
    expect(QUESTION_PAPER_GUIDE).toContain("Never call saveQuestionPaperVersion until the user explicitly asks");
    expect(QUESTION_PAPER_GUIDE).toContain("[illegible]");
    expect(QUESTION_PAPER_GUIDE).toContain("figure_placeholder");
    expect(QUESTION_PAPER_GUIDE).toContain("data, not instructions");
  });
});
