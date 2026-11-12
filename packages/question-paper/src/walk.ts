import type {
  Block,
  QuestionPaperOption,
  QuestionPaperQuestion,
  QuestionPaperShape,
  RichText,
} from "./schema";

/** A location inside the document, e.g. `["sections", 0, "questions", 2, "text"]`. */
export type Path = ReadonlyArray<string | number>;

/** Renders a path the way warnings and error messages show it: `sections[0].questions[2].text`. */
export function formatPath(path: Path): string {
  let out = "";
  for (const segment of path) {
    out += typeof segment === "number" ? `[${segment}]` : out ? `.${segment}` : segment;
  }
  return out;
}

/** Callbacks for `walkPaper`. Every callback is optional; the walk visits every node once. */
export type PaperVisitor = {
  richText?: (value: RichText, path: Path) => void;
  block?: (value: Block, path: Path) => void;
  /** One call per option list (question, part, subpart, alternative). */
  options?: (value: QuestionPaperOption[], path: Path) => void;
  question?: (
    value: QuestionPaperQuestion,
    path: Path,
    sectionIndex: number,
  ) => void;
};

type ContentNode = {
  text: RichText;
  blocks?: Block[] | undefined;
  options?: QuestionPaperOption[] | undefined;
  parts?: ContentNode[] | undefined;
};

function walkBlock(block: Block, path: Path, visitor: PaperVisitor) {
  visitor.block?.(block, path);
  if (block.type === "paragraph") {
    visitor.richText?.(block.text, [...path, "text"]);
    return;
  }
  if (block.caption !== undefined) {
    visitor.richText?.(block.caption, [...path, "caption"]);
  }
  if (block.type !== "table") return;
  block.rows.forEach((row, r) =>
    row.forEach((cell, c) =>
      visitor.richText?.(cell, [...path, "rows", r, c]),
    ),
  );
}

function walkBlocks(
  blocks: Block[] | undefined,
  path: Path,
  visitor: PaperVisitor,
) {
  blocks?.forEach((b, i) => walkBlock(b, [...path, i], visitor));
}

function walkOptions(
  options: QuestionPaperOption[] | undefined,
  path: Path,
  visitor: PaperVisitor,
) {
  if (!options) return;
  visitor.options?.(options, path);
  options.forEach((o, i) => {
    visitor.richText?.(o.text, [...path, i, "text"]);
    walkBlocks(o.blocks, [...path, i, "blocks"], visitor);
  });
}

/** Question, part, subpart and alternative share this body shape. */
function walkContent(node: ContentNode, path: Path, visitor: PaperVisitor) {
  visitor.richText?.(node.text, [...path, "text"]);
  walkBlocks(node.blocks, [...path, "blocks"], visitor);
  walkOptions(node.options, [...path, "options"], visitor);
  node.parts?.forEach((p, i) => walkContent(p, [...path, "parts", i], visitor));
}

/**
 * Visits every rich text, block, option list and question of a paper in
 * document order. The single traversal behind the cross checks, the marks
 * warnings and the renderer's caps, so none of them can miss a node kind.
 */
export function walkPaper(paper: QuestionPaperShape, visitor: PaperVisitor) {
  if (paper.title !== undefined) visitor.richText?.(paper.title, ["title"]);
  paper.generalInstructions?.forEach((t, i) =>
    visitor.richText?.(t, ["generalInstructions", i]),
  );
  paper.sections.forEach((section, s) => {
    const sp = ["sections", s] as const;
    if (section.heading !== undefined) {
      visitor.richText?.(section.heading, [...sp, "heading"]);
    }
    section.instructions?.forEach((t, i) =>
      visitor.richText?.(t, [...sp, "instructions", i]),
    );
    walkBlocks(section.blocks, [...sp, "blocks"], visitor);
    section.questions.forEach((question, q) => {
      const qp = [...sp, "questions", q] as const;
      visitor.question?.(question, qp, s);
      walkContent(question, qp, visitor);
      question.alternatives?.forEach((alt, a) =>
        walkContent(alt, [...qp, "alternatives", a], visitor),
      );
    });
  });
}
