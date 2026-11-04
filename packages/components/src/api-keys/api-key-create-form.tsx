'use client';

import {
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_EXPIRY_OPTIONS_DAYS,
  API_KEY_NAME_MAX_LENGTH,
} from '@campuspilot/auth/api-key-policy';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@campuspilot/ui/components/select';
import { useForm } from '@tanstack/react-form';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { z } from 'zod';

import { FormErrors } from '../admission/form-errors';

export type ApiKeyCreateValues = { name: string; expiresInDays: number };

const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Key name is required.')
    .max(
      API_KEY_NAME_MAX_LENGTH,
      `Use at most ${API_KEY_NAME_MAX_LENGTH} characters.`,
    ),
  expiresInDays: z.number().int().positive(),
});

function expiryLabel(days: number) {
  return days === 365 ? '1 year' : `${days} days`;
}

function ApiKeyExpirySelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger id="api-key-expiry" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {API_KEY_EXPIRY_OPTIONS_DAYS.map((days) => (
          <SelectItem key={days} value={String(days)}>
            {expiryLabel(days)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Collects a key name and lifetime. The caller performs the request; a thrown
 * error is shown under the form and the entered values are kept for a retry.
 */
export function ApiKeyCreateForm({
  onCreate,
}: {
  onCreate: (values: ApiKeyCreateValues) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      name: '',
      expiresInDays: API_KEY_DEFAULT_EXPIRY_DAYS,
    } as ApiKeyCreateValues,
    validators: { onSubmit: createApiKeySchema },
    onSubmit: async ({ value }) => {
      try {
        await onCreate({ ...value, name: value.name.trim() });
        form.reset();
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error
                ? error.message
                : 'Unable to create the API key.',
          },
        });
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <form.Field name="name">
          {(field) => (
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Label htmlFor="api-key-name">Key name</Label>
              <Input
                id="api-key-name"
                name={field.name}
                value={field.state.value}
                placeholder="Claude Code on my laptop"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FormErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="expiresInDays">
          {(field) => (
            <div className="flex flex-col gap-2 sm:w-32">
              <Label htmlFor="api-key-expiry">Expires after</Label>
              <ApiKeyExpirySelect
                value={field.state.value}
                onChange={field.handleChange}
              />
            </div>
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button
              type="submit"
              className="self-start sm:mt-5"
              disabled={!canSubmit || isSubmitting}
            >
              {isSubmitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <KeyRound />
              )}
              Create key
            </Button>
          )}
        </form.Subscribe>
      </div>
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(submitError) =>
          typeof submitError === 'string' ? (
            <p className="text-xs text-destructive">{submitError}</p>
          ) : null
        }
      </form.Subscribe>
    </form>
  );
}
