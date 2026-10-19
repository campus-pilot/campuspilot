"use client";

import { useForm } from "@tanstack/react-form";
import { Sparkles } from "lucide-react";
import { z } from "zod";
import { CopyTextButton } from "@campuspilot/components/documents/copy-text-button";
import {
  createTemplateEditingPrompt,
  type TemplatePromptKind,
} from "@campuspilot/components/documents/template-prompt";
import {
  DocumentButton,
  DocumentField,
  DocumentNotice,
} from "@campuspilot/components/documents/document-controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@campuspilot/ui/components/dialog";

/** Opens the portable AI editing workflow without displacing the editor and
 * preview. The generated prompt remains vendor-neutral and never sends data.
 */
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
    defaultValues: { open: false, instructions: "" },
    validators: {
      onChange: z.object({
        open: z.boolean(),
        instructions: z
          .string()
          .trim()
          .min(1, "Describe the changes you want")
          .max(4000, "Keep instructions within 4,000 characters"),
      }),
    },
  });

  return (
    <form.Subscribe selector={(state) => state.values.open}>
      {(open) => (
        <>
          <DocumentButton
            variant="outline"
            onClick={() => form.setFieldValue("open", true)}
          >
            <Sparkles />
            Edit with AI
          </DocumentButton>
          <Dialog
            open={open}
            onOpenChange={(nextOpen) => form.setFieldValue("open", nextOpen)}
          >
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Edit with your own AI app</DialogTitle>
                <DialogDescription>
                  Describe the change, copy an editing brief, and paste it into
                  your preferred AI app. Nothing is sent from CampusPilot.
                </DialogDescription>
              </DialogHeader>
              <div className="flex min-w-0 flex-col gap-4">
                <form.Field name="instructions">
                  {(field) => (
                    <DocumentField
                      field={field}
                      label="Editing instructions"
                      multiline
                      description="For example: Use our school green, make the student photo larger, and add a principal signature area."
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
                      contextHelp &&
                        content.trim() &&
                        instructions.trim() &&
                        canSubmit,
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
                        {!contextHelp ? (
                          <DocumentNotice>
                            The template reference is still loading. Retry the
                            preview if it does not become available.
                          </DocumentNotice>
                        ) : null}
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
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </form.Subscribe>
  );
}
