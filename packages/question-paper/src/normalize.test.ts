import { describe, expect, it } from "vitest";

import { EXAMPLE_ENGLISH_SCIENCE_PAPER, EXAMPLE_HINDI_MATH_PAPER } from "./examples";
import {
  canonicalQuestionPaperJson,
  normalizeQuestionPaper,
  questionPaperContentSha256,
  questionPaperDraftId,
} from "./normalize";

function normalized(input: unknown) {
  const result = normalizeQuestionPaper(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

describe("normalizeQuestionPaper", () => {
  it("returns path-qualified errors for invalid input", () => {
    const result = normalizeQuestionPaper({
      ...EXAMPLE_ENGLISH_SCIENCE_PAPER,
      sections: [{ questions: [{ number: "1", type: "mcq", text: "x", marks: 0.1 }] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toBe("sections[0].questions[0].marks");
  });

  it("rejects non-objects without throwing", () => {
    for (const bad of [null, undefined, 3, "x", []]) {
      expect(normalizeQuestionPaper(bad).ok).toBe(false);
    }
  });

  it("applies Unicode NFC so equivalent text is stored identically", () => {
    const decomposed = structuredClone(EXAMPLE_ENGLISH_SCIENCE_PAPER);
    decomposed.sections[0]!.questions[0]!.text = "Café";
    const composed = structuredClone(EXAMPLE_ENGLISH_SCIENCE_PAPER);
    composed.sections[0]!.questions[0]!.text = "Café";
    expect(normalized(decomposed).sections[0]!.questions[0]!.text).toBe("Café");
    expect(questionPaperDraftId(normalized(decomposed))).toBe(
      questionPaperDraftId(normalized(composed)),
    );
  });

  it("is idempotent", () => {
    const once = normalized(EXAMPLE_HINDI_MATH_PAPER);
    expect(normalized(once)).toEqual(once);
  });
});

describe("canonical form and draft id", () => {
  it("does not depend on key order", () => {
    const a = normalized(EXAMPLE_ENGLISH_SCIENCE_PAPER);
    const reversed = JSON.parse(
      JSON.stringify(a, (_, v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).reverse())
          : v,
      ),
    );
    expect(canonicalQuestionPaperJson(normalized(reversed))).toBe(canonicalQuestionPaperJson(a));
    expect(questionPaperContentSha256(normalized(reversed))).toBe(questionPaperContentSha256(a));
  });

  it("is a stable 12 hex character prefix that changes with the content", () => {
    const a = normalized(EXAMPLE_ENGLISH_SCIENCE_PAPER);
    expect(questionPaperDraftId(a)).toMatch(/^[0-9a-f]{12}$/);
    expect(questionPaperDraftId(a)).toBe(questionPaperDraftId(structuredClone(a)));
    const changed = structuredClone(a);
    changed.sections[0]!.questions[0]!.marks = 2;
    expect(questionPaperDraftId(changed)).not.toBe(questionPaperDraftId(a));
    expect(questionPaperContentSha256(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
