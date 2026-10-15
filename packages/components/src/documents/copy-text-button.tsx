"use client";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Check, Copy } from "lucide-react";
import { DocumentButton, DocumentNotice } from "./document-controls";

/** Clipboard writes occur only on a user action. A stored copy fingerprint
 * prevents a later edit from being falsely reported as already copied.
 */
export function CopyTextButton({
  text,
  label,
  disabled = false,
}: {
  text: string;
  label: string;
  disabled?: boolean;
}) {
  const form = useForm({
    defaultValues: { copiedText: "", error: "" },
    validators: {
      onChange: z.object({ copiedText: z.string(), error: z.string() }),
    },
    onSubmit: async () => {
      form.setFieldValue("error", "");
      try {
        await navigator.clipboard.writeText(text);
        form.setFieldValue("copiedText", text);
      } catch {
        form.setFieldValue(
          "error",
          "Clipboard access is unavailable. Select and copy the text from the preview instead.",
        );
      }
    },
  });
  return (
    <form.Subscribe
      selector={(state) => ({
        ...state.values,
        canSubmit: state.canSubmit,
        submitting: state.isSubmitting,
      })}
    >
      {({ copiedText, error, canSubmit, submitting }) => (
        <div className="flex flex-col gap-2">
          <DocumentButton
            type="button"
            variant="outline"
            disabled={disabled || !text || !canSubmit || submitting}
            onClick={() => void form.handleSubmit()}
          >
            {copiedText === text && text ? <Check /> : <Copy />}
            {submitting
              ? "Copying…"
              : copiedText === text && text
                ? `${label} · Copied`
                : label}
          </DocumentButton>
          {error && <DocumentNotice error>{error}</DocumentNotice>}
        </div>
      )}
    </form.Subscribe>
  );
}
