"use client";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { CopyTextButton } from "@campuspilot/components/documents/copy-text-button";
import {
  createTemplateEditingPrompt,
  type TemplatePromptKind,
} from "@campuspilot/components/documents/template-prompt";
import {
  DocumentField,
  DocumentPanel,
  DocumentNotice,
} from "@campuspilot/components/documents/document-controls";

export function TemplatePromptEditor({
  documentType,
  content,
  contextHelp,
}: {
  documentType: TemplatePromptKind;
  content: string;
  contextHelp?: string;
}) {
  const form = useForm({
    defaultValues: { instructions: "" },
    validators: {
      onChange: z.object({
        instructions: z
          .string()
          .trim()
          .min(1, "Describe the changes you want")
          .max(4000, "Keep instructions within 4,000 characters"),
      }),
    },
  });
  return (
    <DocumentPanel
      title="Edit with your own AI app"
      description="Describe a change, copy the editing brief, and paste it into your preferred AI app. Paste the returned HTML into the editor above, then preview and save."
    >
      <form.Field name="instructions">
        {(field) => (
          <DocumentField
            field={field}
            label="Editing instructions"
            multiline
            description="For example: Use our school’s green color, make the student photo larger, and add a principal signature area."
          />
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) => ({
          instructions: state.values.instructions,
          canSubmit: state.canSubmit,
        })}
      >
        {({ instructions, canSubmit }) => {
          const ready = Boolean(
            contextHelp && content.trim() && instructions.trim() && canSubmit,
          );
          const prompt = createTemplateEditingPrompt({
            documentType,
            instructions,
            contextHelp: contextHelp ?? "",
          });
          const combined = createTemplateEditingPrompt({
            documentType,
            instructions,
            contextHelp: contextHelp ?? "",
            content,
          });
          return (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <CopyTextButton
                  text={prompt}
                  label="Copy prompt"
                  disabled={!ready}
                />
                <CopyTextButton text={content} label="Copy HTML" />
                <CopyTextButton
                  text={combined}
                  label="Copy prompt + HTML"
                  disabled={!ready}
                />
              </div>
              {!contextHelp && (
                <DocumentNotice>
                  The context reference is loading. Retry the template preview
                  if it cannot be loaded.
                </DocumentNotice>
              )}
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Review prompt and HTML
                </summary>
                <textarea
                  aria-label="Prompt and HTML to copy"
                  readOnly
                  value={combined}
                  rows={12}
                  className="mt-3 w-full rounded-lg border bg-background p-3 font-mono text-xs"
                />
              </details>
            </div>
          );
        }}
      </form.Subscribe>
    </DocumentPanel>
  );
}
