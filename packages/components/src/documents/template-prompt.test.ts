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
});
