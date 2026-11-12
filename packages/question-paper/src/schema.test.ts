import { describe, expect, it } from "vitest";

import {
  EXAMPLE_ENGLISH_SCIENCE_PAPER,
  EXAMPLE_HINDI_MATH_PAPER,
} from "./examples";
import { QUESTION_PAPER_LIMITS as L } from "./limits";
import { questionPaper, type QuestionPaperInput } from "./schema";

const clone = (): QuestionPaperInput =>
  structuredClone(EXAMPLE_ENGLISH_SCIENCE_PAPER);

/** Issues of parsing `paper`, as `path: message` strings. */
function issues(paper: unknown): string[] {
  const result = questionPaper.safeParse(paper);
  return result.success
    ? []
    : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

function minimalQuestion(number: string) {
  return {
    number,
    type: "short_answer" as const,
    text: "Q",
    marks: 1,
  };
}

describe("questionPaper schema", () => {
  it("accepts both worked examples", () => {
    expect(issues(EXAMPLE_HINDI_MATH_PAPER)).toEqual([]);
    expect(issues(EXAMPLE_ENGLISH_SCIENCE_PAPER)).toEqual([]);
  });

  it("applies the table header default", () => {
    const paper = clone();
    const section = paper.sections[1]!;
    const block = section.questions[1]!.blocks![0]!;
    if (block.type !== "table") throw new Error("fixture changed");
    delete block.header;
    const parsed = questionPaper.parse(paper);
    const parsedBlock = parsed.sections[1]!.questions[1]!.blocks![0]!;
    expect(parsedBlock.type === "table" && parsedBlock.header).toBe(false);
  });

  it("rejects unknown keys at every level with a path", () => {
    const top = { ...clone(), extra: 1 };
    expect(issues(top).join()).toContain("extra");
    const nested = clone();
    (nested.sections[0]!.questions[0] as Record<string, unknown>).typo = true;
    expect(issues(nested).join()).toContain("sections.0.questions.0");
    const run = clone();
    run.sections[0]!.questions[0]!.text = [{ t: "text", v: "x", bold: true } as never];
    expect(issues(run).length).toBeGreaterThan(0);
  });

  it("rejects an unsupported schema version, language and script", () => {
    expect(issues({ ...clone(), schemaVersion: 2 }).length).toBeGreaterThan(0);
    const paper = clone();
    paper.meta.language = "xx" as never;
    expect(issues(paper).join()).toContain("meta.language");
    const scripted = clone();
    scripted.meta.script = "klingon" as never;
    expect(issues(scripted).join()).toContain("meta.script");
  });

  it("requires marks in multiples of 0.25 within 0..1000, null allowed", () => {
    for (const marks of [0.3, -1, 1001]) {
      const paper = clone();
      paper.sections[0]!.questions[0]!.marks = marks;
      expect(issues(paper).join()).toContain("marks");
    }
    for (const marks of [0, 0.25, 1000, null]) {
      const paper = clone();
      paper.sections[0]!.questions[0]!.marks = marks;
      expect(issues(paper)).toEqual([]);
    }
  });

  it("only accepts stored (qpf_) and chat (asat_) image ids", () => {
    const withImage = (imageId: string) => {
      const paper = clone();
      paper.sections[2]!.questions[2]!.blocks = [
        { type: "figure", imageId, alt: "heart" },
      ];
      return paper;
    };
    expect(issues(withImage(`qpf_${"a".repeat(21)}`))).toEqual([]);
    expect(issues(withImage(`asat_${"b".repeat(21)}`))).toEqual([]);
    expect(issues(withImage("https://example.com/x.png")).length).toBeGreaterThan(0);
    expect(issues(withImage(`qpg_${"a".repeat(21)}`)).length).toBeGreaterThan(0);
  });

  describe("cross checks", () => {
    it("rejects a table with ragged rows", () => {
      const paper = clone();
      const block = paper.sections[1]!.questions[1]!.blocks![0]!;
      if (block.type !== "table") throw new Error("fixture changed");
      block.rows[2] = ["Mercury"];
      expect(issues(paper).join()).toContain(
        "sections.1.questions.1.blocks.0.rows.2: Every table row must have 2 cells",
      );
    });

    it("rejects duplicate option labels within one question only", () => {
      const paper = clone();
      paper.sections[0]!.questions[0]!.options![1]!.label = "a";
      expect(issues(paper).join()).toContain(
        "sections.0.questions.0.options.1.label",
      );
      // The same label in a different question is normal.
      expect(issues(clone())).toEqual([]);
    });

    it("rejects control characters anywhere but allows tab and newline", () => {
      const paper = clone();
      paper.sections[0]!.questions[0]!.options![0]!.label = "a\u0007";
      expect(issues(paper).join()).toContain("Control characters");
      const ok = clone();
      ok.generalInstructions = ["line one\nline two\tcolumn"];
      expect(issues(ok)).toEqual([]);
    });

    it("rejects right-to-left with a non-arabic script, and nothing else about direction", () => {
      const bad = clone();
      bad.meta.direction = "rtl";
      expect(issues(bad).join()).toContain("meta.script");
      const urdu = clone();
      urdu.meta.direction = "rtl";
      urdu.meta.script = "arabic";
      urdu.meta.language = "ur";
      expect(issues(urdu)).toEqual([]);
      const arabicLtr = clone();
      arabicLtr.meta.script = "arabic";
      expect(issues(arabicLtr)).toEqual([]);
    });

    it("limits the characters of a whole rich text", () => {
      const paper = clone();
      paper.sections[0]!.questions[0]!.text = Array.from(
        { length: 3 },
        () => "x".repeat(1_500),
      );
      expect(issues(paper).join()).toContain(String(L.richChars));
    });

    it("limits questions, math expressions, tables and figures per paper", () => {
      const manyQuestions = clone();
      manyQuestions.sections = Array.from({ length: 4 }, (_, s) => ({
        questions: Array.from({ length: 80 }, (_, q) => minimalQuestion(`${s}-${q}`)),
      }));
      expect(issues(manyQuestions).join()).toContain("at most 300 questions");

      const mathHeavy = clone();
      mathHeavy.sections = [
        {
          questions: Array.from({ length: 7 }, (_, q) => ({
            ...minimalQuestion(String(q)),
            text: Array.from({ length: 100 }, () => ({ t: "math" as const, tex: "x" })).reduce<
              unknown[]
            >((runs, run, i) => (i < 60 ? [...runs, run] : runs), []) as never,
          })),
        },
      ];
      // 7 questions x 60 math runs = 420: under the cap, so valid.
      expect(issues(mathHeavy)).toEqual([]);
      mathHeavy.sections[0]!.questions.push(
        ...Array.from({ length: 4 }, (_, q) => ({
          ...minimalQuestion(`m${q}`),
          text: Array.from({ length: 60 }, () => ({ t: "math" as const, tex: "x" })),
        })),
      );
      expect(issues(mathHeavy).join()).toContain("at most 600 math expressions");

      const tables = clone();
      tables.sections = [
        {
          questions: [
            {
              ...minimalQuestion("1"),
              blocks: Array.from({ length: 10 }, () => ({
                type: "table" as const,
                header: false,
                rows: [["a"]],
              })),
            },
            {
              ...minimalQuestion("2"),
              blocks: Array.from({ length: 3 }, () => ({
                type: "table" as const,
                header: false,
                rows: [["a"]],
              })),
            },
          ],
        },
      ];
      expect(issues(tables).join()).toContain("at most 12 tables");

      const figures = clone();
      figures.sections = [
        {
          questions: Array.from({ length: 4 }, (_, q) => ({
            ...minimalQuestion(String(q)),
            blocks: Array.from({ length: 8 }, () => ({
              type: "figure_placeholder" as const,
              description: "a figure",
            })),
          })),
        },
      ];
      expect(issues(figures).join()).toContain("at most 30 figures");
    });

    it("limits the serialized size of the whole paper", () => {
      const paper = clone();
      paper.sections = Array.from({ length: 20 }, (_, s) => ({
        questions: Array.from({ length: 15 }, (_, q) => ({
          ...minimalQuestion(`${s}.${q}`),
          text: "y".repeat(L.richChars),
          blocks: [{ type: "paragraph" as const, text: "z".repeat(L.richChars) }],
        })),
      }));
      expect(issues(paper).join()).toContain("larger than 200000 characters");
    });
  });

  describe("structural limits", () => {
    it("caps sections, options, alternatives and parts", () => {
      const sections = clone();
      sections.sections = Array.from({ length: L.sections + 1 }, () => ({
        questions: [minimalQuestion("1")],
      }));
      expect(issues(sections).length).toBeGreaterThan(0);

      const options = clone();
      options.sections[0]!.questions[0]!.options = Array.from(
        { length: L.options + 1 },
        (_, i) => ({ label: String(i), text: "o" }),
      );
      expect(issues(options).length).toBeGreaterThan(0);

      const alternatives = clone();
      alternatives.sections[0]!.questions[0]!.alternatives = Array.from(
        { length: L.alternatives + 1 },
        () => ({ text: "alt" }),
      );
      expect(issues(alternatives).length).toBeGreaterThan(0);
    });

    it("needs at least two options and non-empty sections", () => {
      const single = clone();
      single.sections[0]!.questions[0]!.options = [{ label: "a", text: "only" }];
      expect(issues(single).length).toBeGreaterThan(0);
      const empty = clone();
      empty.sections[0]!.questions = [];
      expect(issues(empty).length).toBeGreaterThan(0);
    });
  });
});
