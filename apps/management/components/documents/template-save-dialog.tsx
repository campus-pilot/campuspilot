'use client';

import { useForm } from '@tanstack/react-form';
import { Save } from 'lucide-react';
import { z } from 'zod';
import { DocumentButton, DocumentField, DocumentSelect } from '@campuspilot/components/documents/document-controls';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';

import type { TemplateFootprint } from './template-save-model';

const footprintOptions = [
  { value: '', label: 'Choose the paper footprint' },
  { value: 'half', label: 'Half A4 · two per sheet' },
  { value: 'full', label: 'Full A4 · one per sheet' },
] as const;

/** What Save stores besides the HTML, as the person confirmed it. */
export type ConfirmedSave = { name: string; pageSize: TemplateFootprint };

/**
 * Save confirms the template's name and, for types that print two-up, its
 * paper footprint before a revision is stored (docs/document-system.md,
 * "Saving a template"). The footprint starts as `initialFootprint`: unselected
 * (null) when the HTML differs from the loaded revision, so a pasted design
 * never keeps another design's footprint by accident.
 */
export function TemplateSaveDialog({
  open,
  name,
  initialFootprint,
  choosableFootprint,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  name: string;
  initialFootprint: TemplateFootprint | null;
  /** Whether this type offers half A4 (otherwise only the name is confirmed). */
  choosableFootprint: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (save: ConfirmedSave) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save template</DialogTitle>
          <DialogDescription>
            Saving creates a new revision and makes it the school&apos;s {choosableFootprint ? 'template. Confirm its name and the paper it prints on.' : 'template. Confirm its name.'}
          </DialogDescription>
        </DialogHeader>
        {/* Keyed by what it starts from, so each opening starts afresh (no effect). */}
        {open ? (
          <SaveForm
            key={`${name}:${initialFootprint ?? 'none'}`}
            name={name}
            initialFootprint={initialFootprint}
            choosableFootprint={choosableFootprint}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SaveForm({
  name,
  initialFootprint,
  choosableFootprint,
  onCancel,
  onConfirm,
}: {
  name: string;
  initialFootprint: TemplateFootprint | null;
  choosableFootprint: boolean;
  onCancel: () => void;
  onConfirm: (save: ConfirmedSave) => void;
}) {
  const form = useForm({
    defaultValues: { name, pageSize: (initialFootprint ?? '') as TemplateFootprint | '' },
    validators: {
      onChange: z.object({
        name: z.string().trim().min(1, 'Give this template a name').max(120),
        pageSize: z.enum(['full', 'half'], { message: 'Choose the paper footprint of this design.' }),
      }),
    },
    onSubmit: ({ value }) => {
      if (value.pageSize) onConfirm({ name: value.name.trim(), pageSize: value.pageSize });
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name">{(field) => <DocumentField field={field} label="Template name" />}</form.Field>
      {choosableFootprint ? (
        <form.Field name="pageSize">{(field) => <DocumentSelect field={field} label="Paper footprint" options={footprintOptions} />}</form.Field>
      ) : null}
      <DialogFooter>
        <DocumentButton variant="outline" onClick={onCancel}>
          Cancel
        </DocumentButton>
        <form.Subscribe selector={(state) => state.canSubmit && state.values.pageSize !== ''}>
          {(ready) => (
            <DocumentButton type="submit" disabled={!ready}>
              <Save />
              Save template
            </DocumentButton>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}
