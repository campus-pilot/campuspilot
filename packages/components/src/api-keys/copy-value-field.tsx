'use client';

import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { useForm } from '@tanstack/react-form';
import { Check, Clipboard } from 'lucide-react';

/**
 * Read-only value with a copy button. Clipboard writes happen only on a user
 * action; the copied value is remembered so an edited value is never shown as
 * already copied (same approach as the documents CopyTextButton).
 */
export function CopyValueField({
  id,
  value,
  label,
  multiline = false,
}: {
  id: string;
  value: string;
  /** Accessible name of the copy button, e.g. "Copy API key". */
  label: string;
  multiline?: boolean;
}) {
  const form = useForm({
    defaultValues: { copiedValue: '', error: '' },
    onSubmit: async () => {
      form.setFieldValue('error', '');
      try {
        await navigator.clipboard.writeText(value);
        form.setFieldValue('copiedValue', value);
      } catch {
        form.setFieldValue(
          'error',
          'Clipboard access is unavailable. Select the text and copy it instead.',
        );
      }
    },
  });

  return (
    <form.Subscribe selector={(state) => state.values}>
      {({ copiedValue, error }) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            {multiline ? (
              <pre
                id={id}
                className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed"
              >
                {value}
              </pre>
            ) : (
              <Input id={id} value={value} readOnly className="font-mono" />
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={label}
              onClick={() => void form.handleSubmit()}
            >
              {copiedValue === value ? <Check /> : <Clipboard />}
            </Button>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      )}
    </form.Subscribe>
  );
}
