import {
  TEMPLATE_DOCUMENT_LABELS,
  templateRenderingContract,
  type TemplateDocumentType,
  type TemplatePageSize,
} from "@campuspilot/assistant-contract/template-editing";

export type TemplatePromptKind = TemplateDocumentType;
export type TemplatePromptPageSize = TemplatePageSize;

/** Build an exportable editing brief, never a provider request. The caller
 * supplies the latest unsaved HTML and the server's variable specification.
 * Omitting HTML supports copying the instructions and source separately.
 * The printing rules are the shared ones the in-app assistant also reads
 * (`@campuspilot/assistant-contract/template-editing`).
 */
export function createTemplateEditingPrompt(input: {
  documentType: TemplatePromptKind;
  instructions: string;
  contextHelp: string;
  content?: string;
  pageSize?: TemplatePromptPageSize;
}) {
  const sections = [
    `Edit my CampusPilot ${TEMPLATE_DOCUMENT_LABELS[input.documentType]} template.`,
    `Requested changes:\n${input.instructions.trim()}`,
    `Rendering contract:\n${templateRenderingContract({
      documentType: input.documentType,
      pageSize: input.pageSize,
      output: "Return the COMPLETE final HTML/Handlebars template only, without Markdown fences or commentary.",
    })}`,
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
