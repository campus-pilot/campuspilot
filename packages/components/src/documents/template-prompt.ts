export type TemplatePromptKind =
  "report_card" | "id_card" | "admit_card" | "timetable" | "bill" | "receipt" | "statement";
export type TemplatePromptPageSize = "full" | "half";
const labels: Record<TemplatePromptKind, string> = {
  report_card: "student report card",
  id_card: "student ID card",
  admit_card: "examination admit card",
  timetable: "examination timetable",
  bill: "finance bill",
  receipt: "payment or refund receipt",
  statement: "admission account statement",
};

/** Build an exportable editing brief, never a provider request. The caller
 * supplies the latest unsaved HTML and the server's variable specification.
 * Omitting HTML supports copying the instructions and source separately.
 */
export function createTemplateEditingPrompt(input: {
  documentType: TemplatePromptKind;
  instructions: string;
  contextHelp: string;
  content?: string;
  pageSize?: TemplatePromptPageSize;
}) {
  const paper =
    input.documentType === "id_card"
      ? "Each card must fit exactly 86mm × 54mm. CampusPilot imposes the cards onto A4 sheets."
      : input.documentType === "timetable"
        ? "Use landscape A4."
        : input.pageSize === "half"
          ? "Design one half-A4 document (210mm × 148.5mm). CampusPilot places two documents vertically on each portrait A4 sheet."
          : "Use portrait A4. Each student document starts on a new printed page.";
  const sections = [
    `Edit my CampusPilot ${labels[input.documentType]} template.`,
    `Requested changes:\n${input.instructions.trim()}`,
    `Rendering contract:\n- This is HTML with Handlebars bindings, rendered to PDF using Gotenberg/Chromium.\n- ${paper}\n- Return the COMPLETE final HTML/Handlebars template only, without Markdown fences or commentary.\n- Preserve existing bindings and conditional/loop structure unless the requested changes require otherwise. Do not replace variables with sample or invented student data.\n- Use self-contained CSS in style blocks or inline styles. No JavaScript, forms, external images, fonts, stylesheets, or network requests.\n- School logos and student photos are provided as data URIs; use the documented image variables with conditional checks for missing images.\n- Use standard Handlebars helpers such as each, if, unless, and lookup. Only own properties are available.\n- Treat missing optional values explicitly and never fabricate zero marks, attendance, or grades.\n- Attendance and co-scholastic activities come from the exam-wide assessment. Use the documented root fields and honor reportSections printing flags. Never promote legacy subject metadata to shared values.`,
    `Available template variables and context:\n${input.contextHelp.trim()}`,
  ];
  if (input.content !== undefined)
    sections.push(
      `Current template HTML (edit this complete source):\n<campuspilot-template>\n${input.content}\n</campuspilot-template>`,
    );
  else
    sections.push(
      "I will provide the current template HTML separately. Apply the requested changes to that source.",
    );
  return sections.join("\n\n");
}
