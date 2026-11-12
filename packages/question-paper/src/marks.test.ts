import { describe, expect, it } from "vitest";

import {
  EXAMPLE_ENGLISH_SCIENCE_PAPER,
  EXAMPLE_HINDI_MATH_PAPER,
} from "./examples";
import { computePaperMarks, paperWarnings, type WarningCode } from "./marks";
import { questionPaper } from "./schema";

function paperOf(
  questions: Array<Record<string, unknown>>,
  section: Record<string, unknown> = {},
  meta: Record<string, unknown> = {},
) {
  return questionPaper.parse({
    schemaVersion: 1,
    meta: { language: "en", script: "latin", direction: "ltr", ...meta },
    sections: [{ ...section, questions }],
  });
}
const q = (number: string, extra: Record<string, unknown> = {}) => ({
  number,
  type: "short_answer",
  text: "Q",
  marks: 1,
  ...extra,
});
const codes = (paper: ReturnType<typeof paperOf>): WarningCode[] =>
  computePaperMarks(paper).warnings.map((w) => w.code);

describe("computePaperMarks", () => {
  it("totals the two worked examples to 15 and 20 without warnings", () => {
    for (const [example, total] of [
      [EXAMPLE_HINDI_MATH_PAPER, 15],
      [EXAMPLE_ENGLISH_SCIENCE_PAPER, 20],
    ] as const) {
      const result = computePaperMarks(questionPaper.parse(example));
      expect(result.total).toBe(total);
      expect(result.sections.reduce((sum, s) => sum + s.total, 0)).toBe(total);
    }
    // Example 2 intentionally has one placeholder figure; example 1 is clean.
    expect(computePaperMarks(questionPaper.parse(EXAMPLE_HINDI_MATH_PAPER)).warnings).toEqual([]);
    expect(
      computePaperMarks(questionPaper.parse(EXAMPLE_ENGLISH_SCIENCE_PAPER)).warnings.map(
        (w) => w.code,
      ),
    ).toEqual(["figure_placeholder_unresolved"]);
  });

  it("sums parts when the question states no marks, and counts missing marks as 0", () => {
    const paper = paperOf([
      q("1", {
        marks: null,
        parts: [
          { label: "a", text: "a", marks: 2 },
          { label: "b", text: "b", marks: null },
        ],
      }),
    ]);
    const result = computePaperMarks(paper);
    expect(result.total).toBe(2);
    expect(result.warnings.map((w) => w.code)).toEqual(["question_without_marks"]);
    expect(result.warnings[0]!.path).toBe("sections[0].questions[0].parts[1]");
  });

  it("lets own marks win and warns when parts disagree", () => {
    const paper = paperOf([
      q("1", {
        marks: 5,
        parts: [{ label: "a", text: "a", marks: 2 }, { label: "b", text: "b", marks: 2 }],
      }),
    ]);
    expect(computePaperMarks(paper).total).toBe(5);
    expect(codes(paper)).toEqual(["marks_mismatch_children"]);
  });

  it("sums three levels of parts", () => {
    const paper = paperOf([
      q("1", {
        marks: null,
        parts: [
          {
            label: "a",
            text: "a",
            marks: null,
            parts: [
              { label: "i", text: "i", marks: 0.25 },
              { label: "ii", text: "ii", marks: 0.5 },
            ],
          },
        ],
      }),
    ]);
    expect(computePaperMarks(paper).total).toBe(0.75);
    expect(codes(paper)).toEqual([]);
  });

  it("counts the largest branch of an OR question once and warns when unequal", () => {
    const equal = paperOf([q("1", { marks: 4, alternatives: [{ text: "x", marks: 4 }] })]);
    expect(computePaperMarks(equal).total).toBe(4);
    expect(codes(equal)).toEqual([]);
    const unequal = paperOf([q("1", { marks: 3, alternatives: [{ text: "x", marks: 5 }] })]);
    expect(computePaperMarks(unequal).total).toBe(5);
    expect(codes(unequal)).toEqual(["choice_unequal_marks"]);
    const fromParts = paperOf([
      q("1", {
        marks: 4,
        alternatives: [
          { text: "x", parts: [{ label: "a", text: "a", marks: 1.5 }, { label: "b", text: "b", marks: 2.5 }] },
        ],
      }),
    ]);
    expect(computePaperMarks(fromParts).total).toBe(4);
    expect(codes(fromParts)).toEqual([]);
  });

  it("counts the k largest questions of an attempt-any section", () => {
    const section = { attemptAny: 2 };
    const equal = paperOf([q("1"), q("2"), q("3")], section);
    expect(computePaperMarks(equal).total).toBe(2);
    expect(codes(equal)).toEqual([]);
    const unequal = paperOf(
      [q("1", { marks: 5 }), q("2", { marks: 2 }), q("3", { marks: 4 })],
      section,
    );
    expect(computePaperMarks(unequal).total).toBe(9);
    expect(codes(unequal)).toEqual(["choice_unequal_marks"]);
    // k at or above the question count means every question counts.
    expect(computePaperMarks(paperOf([q("1"), q("2")], { attemptAny: 5 })).total).toBe(2);
  });

  it("does not drift on quarter marks", () => {
    const paper = paperOf(
      Array.from({ length: 10 }, (_, i) => q(String(i), { marks: 0.25 })),
    );
    expect(computePaperMarks(paper).total).toBe(2.5);
  });

  it("warns about duplicate numbers, mcq without options and unresolved figures", () => {
    const paper = paperOf([
      q("1"),
      q("1"),
      q("2", { type: "mcq" }),
      q("3", {
        blocks: [
          { type: "figure_placeholder", description: "a" },
          { type: "figure_placeholder", description: "b" },
        ],
      }),
    ]);
    const result = computePaperMarks(paper).warnings;
    expect(result.map((w) => w.code).sort()).toEqual(
      ["duplicate_question_number", "figure_placeholder_unresolved", "mcq_without_options"].sort(),
    );
    expect(result.find((w) => w.code === "figure_placeholder_unresolved")!.message).toBe(
      "2 figures still need an uploaded image.",
    );
  });

  it("compares with the paper header hint", () => {
    const paper = paperOf([q("1", { marks: 3 })], {}, { maxMarks: 5 });
    expect(codes(paper)).toEqual(["total_differs_from_paper_header"]);
    expect(codes(paperOf([q("1", { marks: 3 })], {}, { maxMarks: 3 }))).toEqual([]);
    expect(codes(paperOf([q("1", { marks: 3 })], {}, { maxMarks: null }))).toEqual([]);
  });
});

describe("paperWarnings", () => {
  const paper = paperOf([q("1", { marks: 3 })]);
  it("adds total_differs_from_plan only when the plan max is known and different", () => {
    expect(paperWarnings(paper, { planMaxMarks: null })).toEqual([]);
    expect(paperWarnings(paper, { planMaxMarks: 3 })).toEqual([]);
    const [warning] = paperWarnings(paper, { planMaxMarks: 80 });
    expect(warning).toMatchObject({ code: "total_differs_from_plan", path: "" });
    expect(warning!.message).toContain("3 marks");
    expect(warning!.message).toContain("80");
  });
});
