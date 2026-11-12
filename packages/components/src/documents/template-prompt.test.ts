import { describe, expect, it } from "vitest";
import { createTemplateEditingPrompt } from "./template-prompt";
const input = {
  documentType: "id_card" as const,
  instructions: "  Enlarge the photo  ",
  contextHelp: "student.photo is a data URI",
};
describe("portable template editing brief", () => {
  it("includes the request, variable reference, and correct printing contract", () => {
    const prompt = createTemplateEditingPrompt(input);
    expect(prompt).toContain("Requested changes:\nEnlarge the photo");
    expect(prompt).toContain(input.contextHelp);
    expect(prompt).toContain("86mm × 54mm");
    expect(prompt).toContain("COMPLETE final HTML/Handlebars template only");
    expect(prompt).toContain("current template HTML separately");
    expect(prompt).not.toContain("<campuspilot-template>");
  });
  it("preserves the complete unsaved HTML and bindings byte for byte", () => {
    const content =
      "<style>p { color: green; }</style>\n{{#each students}}<p>{{name}} `special`</p>{{/each}}";
    const prompt = createTemplateEditingPrompt({ ...input, content });
    expect(prompt).toContain(
      `<campuspilot-template>\n${content}\n</campuspilot-template>`,
    );
    expect(prompt).not.toContain("current template HTML separately");
  });
  it("tells the author that a notice flows over pages with a margin on each", () => {
    const prompt = createTemplateEditingPrompt({ ...input, documentType: "notice" });
    expect(prompt).toContain("Edit my CampusPilot school notice template.");
    expect(prompt).toContain("flows over as many pages");
    expect(prompt).toContain("16mm margin");
    expect(prompt).not.toContain("86mm × 54mm");
  });
  it("tells the author the question paper template owns only the heading and footer", () => {
    const prompt = createTemplateEditingPrompt({ ...input, documentType: "question_paper" });
    expect(prompt).toContain("Edit my CampusPilot question paper heading and footer template.");
    expect(prompt).toContain("{{{questionPaper.bodyHtml}}} (triple braces) exactly once");
    expect(prompt).toContain("position:fixed; bottom:0");
    expect(prompt).toContain("never use a negative bottom");
    expect(prompt).toContain("flows over as many pages");
    expect(prompt).toContain("direction:{{questionPaper.direction}}");
    expect(prompt).not.toContain("86mm × 54mm");
    expect(prompt).not.toContain("starts on a new printed page");
  });
  it("asks for one notice design that adapts to both print sizes", () => {
    // The revision's footprint is irrelevant for a notice: the same brief whatever is passed.
    for (const pageSize of ["full", "half"] as const) {
      const prompt = createTemplateEditingPrompt({ ...input, documentType: "notice", pageSize });
      expect(prompt).toContain("print.size");
      expect(prompt).toContain("210mm × 148.5mm");
      expect(prompt).toContain("two copies on each A4 sheet");
    }
  });
  it.each(["report_card", "admit_card", "timetable"] as const)(
    "uses explicit page rules for %s",
    (documentType) => {
      const prompt = createTemplateEditingPrompt({ ...input, documentType });
      expect(prompt).toContain(
        documentType === "timetable" ? "landscape A4" : "portrait A4",
      );
      expect(prompt).not.toContain("86mm × 54mm");
    },
  );
  it("describes two-up imposition for a half-A4 template", () => {
    const prompt = createTemplateEditingPrompt({
      ...input,
      documentType: "receipt",
      pageSize: "half",
    });
    expect(prompt).toContain("210mm × 148.5mm");
    expect(prompt).toContain("two documents vertically");
  });
});
