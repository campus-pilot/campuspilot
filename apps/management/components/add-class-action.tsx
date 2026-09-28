'use client';

import { useState } from 'react';
import { createClassInputSchema } from '@campuspilot/api/routers/school/class/class.dto';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Plus, Trash2 } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { FormErrors } from './form-errors';

const classFormSchema = createClassInputSchema.omit({ schoolId: true });

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function AddClassDialog({
  schoolId,
  onClose,
}: {
  schoolId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: {
      label: '',
      slug: '',
      sections: [{ label: 'A', slug: 'a' }],
    },
    validators: { onSubmit: classFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const validated = classFormSchema.parse(value);
        await client.school.createClass({ schoolId, ...validated });
        await queryClient.invalidateQueries({
          queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }),
        });
        onClose();
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form:
              error instanceof Error
                ? error.message
                : 'Unable to create this classroom.',
            fields: {},
          },
        });
      }
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add classroom</DialogTitle>
          <DialogDescription>
            Create the class and at least one initial section.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="label">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="class-label">Class name</Label>
                  <Input
                    id="class-label"
                    placeholder="e.g. Lower Kindergarten"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const currentGeneratedSlug = slugify(field.state.value);
                      const nextLabel = event.target.value;
                      field.handleChange(nextLabel);
                      if (
                        !form.getFieldValue('slug') ||
                        form.getFieldValue('slug') === currentGeneratedSlug
                      ) {
                        form.setFieldValue('slug', slugify(nextLabel));
                      }
                    }}
                  />
                  <FormErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="slug">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="class-slug">Class slug</Label>
                  <Input
                    id="class-slug"
                    placeholder="lower-kindergarten"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FormErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
          </div>

          <form.Field name="sections" mode="array">
            {(sectionsField) => (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>Initial sections</Label>
                    <p className="text-xs text-muted-foreground">
                      A classroom must always retain at least one section.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      sectionsField.pushValue({ label: '', slug: '' })
                    }
                  >
                    <Plus aria-hidden />
                    Add section
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  {sectionsField.state.value.map((section, index) => (
                    <div
                      key={index}
                      className="grid items-start gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]"
                    >
                      <form.Field name={`sections[${index}].label`}>
                        {(field) => (
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor={`section-${index}-label`}>
                              Name
                            </Label>
                            <Input
                              id={`section-${index}-label`}
                              placeholder="A"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) => {
                                const currentGeneratedSlug = slugify(
                                  field.state.value,
                                );
                                const nextLabel = event.target.value;
                                field.handleChange(nextLabel);
                                const slugPath =
                                  `sections[${index}].slug` as const;
                                if (
                                  !form.getFieldValue(slugPath) ||
                                  form.getFieldValue(slugPath) ===
                                    currentGeneratedSlug
                                ) {
                                  form.setFieldValue(
                                    slugPath,
                                    slugify(nextLabel),
                                  );
                                }
                              }}
                            />
                            <FormErrors errors={field.state.meta.errors} />
                          </div>
                        )}
                      </form.Field>
                      <form.Field name={`sections[${index}].slug`}>
                        {(field) => (
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor={`section-${index}-slug`}>
                              Slug
                            </Label>
                            <Input
                              id={`section-${index}-slug`}
                              placeholder="a"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                            />
                            <FormErrors errors={field.state.meta.errors} />
                          </div>
                        )}
                      </form.Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="mt-6 text-destructive"
                        aria-label={`Remove ${section.label || `section ${index + 1}`}`}
                        disabled={sectionsField.state.value.length === 1}
                        onClick={() => sectionsField.removeValue(index)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
                <FormErrors errors={sectionsField.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              errors: state.errors,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, errors, isSubmitting }) => (
              <>
                <FormErrors errors={errors} />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={onClose}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? 'Creating…' : 'Create classroom'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddClassAction({ schoolId }: { schoolId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        className="rounded-lg"
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden />
        Add classroom
      </Button>
      {open ? (
        <AddClassDialog schoolId={schoolId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
