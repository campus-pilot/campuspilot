'use client';

import { useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { SCHOOL_LOGO_MIME_TYPES } from '@campuspilot/api/routers/system-admin/school/school.constants';
import {
  addSchoolInputSchema,
  type SchoolDto,
} from '@campuspilot/api/routers/system-admin/school/school.dto';
import {
  Dropzone,
  formatFileSize,
} from '@campuspilot/components/dropzone';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campuspilot/ui/components/alert-dialog';
import { Button } from '@campuspilot/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@campuspilot/ui/components/card';
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
import { Progress } from '@campuspilot/ui/components/progress';
import { ImageUp, LoaderCircle, Pencil, Trash2 } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { uploadSchoolLogo } from '@/lib/school-image';
import { SchoolAvatar } from './school-avatar';

const schoolDetailsFormSchema = z.object({
  name: addSchoolInputSchema.shape.name,
  slug: addSchoolInputSchema.shape.slug,
  location: addSchoolInputSchema.shape.location,
  registrationNo: z.string().trim(),
});

const schoolLogoFormSchema = z.object({
  logo: z
    .instanceof(File, { message: 'Choose a logo to upload.' })
    .refine(
      (file) => SCHOOL_LOGO_MIME_TYPES.some((type) => type === file.type),
      { message: 'Choose a JPEG, PNG, or WebP image.' },
    ),
});

function deleteSchoolFormSchema(slug: string) {
  return z.object({
    confirmation: z.string().refine((value) => value === slug, {
      message: `Enter ${slug} exactly to confirm deletion.`,
    }),
  });
}

function FieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : undefined;

    return message ? (
      <p key={`${message}-${index}`} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;
  });
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function SchoolLogoEditor({ school }: { school: SchoolDto }) {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>();
  const accept = SCHOOL_LOGO_MIME_TYPES.join(',');
  const form = useForm({
    defaultValues: { logo: null as File | null },
    validators: {
      onChange: schoolLogoFormSchema,
      onSubmit: schoolLogoFormSchema,
    },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      if (!value.logo) return;

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setUploadProgress(undefined);

      try {
        const updatedSchool = await uploadSchoolLogo(school.id, value.logo, {
          signal: abortController.signal,
          onProgress: setUploadProgress,
        });
        queryClient.setQueryData(
          orpc.systemAdmin.getSchool.queryKey({
            input: { id: school.id },
          }),
          updatedSchool,
        );
        void queryClient.invalidateQueries({
          queryKey: orpc.school.getLogo.queryKey({
            input: { schoolId: school.id },
          }),
        });
        form.reset();
        setUploadProgress(undefined);
        setIsOpen(false);
        void queryClient.invalidateQueries({
          queryKey: orpc.systemAdmin.getSchool.queryKey({
            input: { id: school.id },
          }),
        });
        void queryClient.invalidateQueries({
          queryKey: orpc.systemAdmin.listSchools.queryKey({ input: {} }),
        });
      } catch (error) {
        if (isAbortError(error)) {
          form.reset();
          setUploadProgress(undefined);
          setIsOpen(false);
          return;
        }
        form.setErrorMap({
          onSubmit: {
            form:
              error instanceof Error
                ? error.message
                : 'Unable to upload the school logo.',
            fields: {},
          },
        });
      } finally {
        abortControllerRef.current = undefined;
      }
    },
  });

  /** Cancels an active XHR before closing and resets stale selections. */
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && form.state.isSubmitting) {
      abortControllerRef.current?.abort();
      return;
    }
    if (!nextOpen) {
      form.reset();
      setUploadProgress(undefined);
    }
    setIsOpen(nextOpen);
  }

  return (
    <>
      <button
        type="button"
        className="group relative shrink-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={`Change ${school.name} logo`}
        onClick={() => setIsOpen(true)}
      >
        <SchoolAvatar school={school} className="size-28!" />
        <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Pencil aria-hidden />
          <span className="sr-only">Change logo</span>
        </span>
      </button>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload school logo</DialogTitle>
            <DialogDescription>
              The image is resized and compressed before it is uploaded.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <form.Field name="logo">
                  {(field) => (
                    <div className="flex flex-col gap-2">
                      <Dropzone
                        key={
                          field.state.value
                            ? `${field.state.value.name}-${field.state.value.lastModified}`
                            : 'empty-logo'
                        }
                        name={field.name}
                        accept={accept}
                        aria-label="School logo image"
                        icon={ImageUp}
                        title={
                          field.state.value
                            ? field.state.value.name
                            : 'Drop your logo here'
                        }
                        description="or click to choose an image"
                        footer={
                          <span className="text-xs text-muted-foreground">
                            {field.state.value
                              ? formatFileSize(field.state.value.size)
                              : 'JPEG, PNG, or WebP'}
                          </span>
                        }
                        disabled={isSubmitting}
                        onBlur={field.handleBlur}
                        onFileSelect={(files) =>
                          field.handleChange(files[0] ?? null)
                        }
                        onFilesRejected={(files) =>
                          field.handleChange(files[0] ?? null)
                        }
                      />
                      <FieldErrors errors={field.state.meta.errors} />
                    </div>
                  )}
                </form.Field>
              )}
            </form.Subscribe>
            <form.Subscribe
              selector={(state) => ({
                canSubmit: state.canSubmit,
                isSubmitting: state.isSubmitting,
                errors: state.errors,
                logo: state.values.logo,
              })}
            >
              {({ canSubmit, isSubmitting, errors, logo }) => (
                <div className="flex flex-col gap-4">
                  {isSubmitting ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {uploadProgress === undefined
                            ? 'Preparing image…'
                            : 'Uploading…'}
                        </span>
                        <span>
                          {uploadProgress === undefined
                            ? null
                            : `${uploadProgress}%`}
                        </span>
                      </div>
                      <Progress value={uploadProgress ?? 0} />
                    </div>
                  ) : null}
                  <FieldErrors errors={errors} />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleOpenChange(false)}
                    >
                      {isSubmitting ? 'Cancel upload' : 'Cancel'}
                    </Button>
                    <Button
                      type="submit"
                      disabled={!logo || !canSubmit || isSubmitting}
                    >
                      {isSubmitting ? (
                        <LoaderCircle className="animate-spin" aria-hidden />
                      ) : (
                        <ImageUp aria-hidden />
                      )}
                      {isSubmitting ? 'Uploading…' : 'Upload logo'}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </form.Subscribe>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SchoolDetailsForm({ school }: { school: SchoolDto }) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: {
      name: school.name,
      slug: school.slug,
      location: school.location,
      registrationNo: school.registrationNo ?? '',
    },
    validators: { onSubmit: schoolDetailsFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const updatedSchool = await client.systemAdmin.updateSchool({
          id: school.id,
          name: value.name,
          slug: value.slug,
          location: value.location,
          registrationNo: value.registrationNo || null,
        });
        queryClient.setQueryData(
          orpc.systemAdmin.getSchool.queryKey({
            input: { id: school.id },
          }),
          updatedSchool,
        );
        await queryClient.invalidateQueries({
          queryKey: orpc.systemAdmin.listSchools.queryKey({ input: {} }),
        });
        form.reset({
          name: updatedSchool.name,
          slug: updatedSchool.slug,
          location: updatedSchool.location,
          registrationNo: updatedSchool.registrationNo ?? '',
        });
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form:
              error instanceof Error
                ? error.message
                : 'Unable to update the school.',
            fields: {},
          },
        });
      }
    },
  });

  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="name">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="school-name">Name</Label>
              <Input
                id="school-name"
                name={field.name}
                autoComplete="organization"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="slug">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="school-slug">Slug</Label>
              <Input
                id="school-slug"
                name={field.name}
                autoComplete="off"
                placeholder="green-valley-school"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="location">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="school-location">Location</Label>
              <Input
                id="school-location"
                name={field.name}
                autoComplete="street-address"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="registrationNo">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="school-registration-number">
                Registration number
              </Label>
              <Input
                id="school-registration-number"
                name={field.name}
                autoComplete="off"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
      </div>
      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          isDirty: state.isDirty,
          isSubmitting: state.isSubmitting,
          errors: state.errors,
        })}
      >
        {({ canSubmit, isDirty, isSubmitting, errors }) => (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-end">
            <FieldErrors errors={errors} />
            <Button
              type="submit"
              disabled={!canSubmit || !isDirty || isSubmitting}
            >
              {isSubmitting ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : null}
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

function SchoolProfileCard({ school }: { school: SchoolDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>School details</CardTitle>
        <CardDescription>
          Update the school&apos;s identity and organization details.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <SchoolLogoEditor school={school} />
        <SchoolDetailsForm key={school.id} school={school} />
      </CardContent>
    </Card>
  );
}

function DeleteSchoolDialog({
  school,
  open,
  onOpenChange,
}: {
  school: SchoolDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const schema = deleteSchoolFormSchema(school.slug);
  const form = useForm({
    defaultValues: { confirmation: '' },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async () => {
      form.setErrorMap({});
      try {
        await client.systemAdmin.deleteSchool({ id: school.id });
        await queryClient.invalidateQueries({
          queryKey: orpc.systemAdmin.listSchools.queryKey({ input: {} }),
        });
        router.replace('/organizations');
        router.refresh();
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form:
              error instanceof Error
                ? error.message
                : 'Unable to delete the school.',
            fields: {},
          },
        });
      }
    },
  });

  /** Prevents dismissal during deletion and clears confirmation between opens. */
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && form.state.isSubmitting) return;
    if (!nextOpen) form.reset();
    onOpenChange(nextOpen);
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {school.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the school. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="confirmation">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor="school-delete-confirmation">
                  Enter{' '}
                  <span className="font-mono font-semibold">
                    {school.slug}
                  </span>{' '}
                  to confirm
                </Label>
                <Input
                  id="school-delete-confirmation"
                  name={field.name}
                  autoComplete="off"
                  spellCheck={false}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              confirmation: state.values.confirmation,
              isSubmitting: state.isSubmitting,
              errors: state.errors,
            })}
          >
            {({ canSubmit, confirmation, isSubmitting, errors }) => (
              <div className="flex flex-col gap-3">
                <FieldErrors errors={errors} />
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isSubmitting}>
                    Cancel
                  </AlertDialogCancel>
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={
                      !canSubmit ||
                      confirmation !== school.slug ||
                      isSubmitting
                    }
                  >
                    {isSubmitting ? (
                      <LoaderCircle className="animate-spin" aria-hidden />
                    ) : (
                      <Trash2 aria-hidden />
                    )}
                    {isSubmitting ? 'Deleting…' : 'Delete school'}
                  </Button>
                </AlertDialogFooter>
              </div>
            )}
          </form.Subscribe>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteSchoolCard({ school }: { school: SchoolDto }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>Permanently delete this school.</CardDescription>
      </CardHeader>
      <CardFooter className="border-t">
        <Button
          type="button"
          variant="destructive"
          onClick={() => setIsOpen(true)}
        >
          <Trash2 aria-hidden />
          Delete school
        </Button>
      </CardFooter>
      <DeleteSchoolDialog
        key={`${school.id}-${school.slug}`}
        school={school}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </Card>
  );
}

function SchoolSettingsContent({ school }: { school: SchoolDto }) {
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage school information, branding, and deletion.
        </p>
      </div>
      <SchoolProfileCard school={school} />
      <DeleteSchoolCard school={school} />
    </section>
  );
}

export function SchoolSettings({ schoolId }: { schoolId: string }) {
  const schoolQuery = useQuery(
    orpc.systemAdmin.getSchool.queryOptions({ input: { id: schoolId } }),
  );

  if (schoolQuery.isPending) {
    return (
      <section className="mx-auto flex w-full max-w-4xl animate-pulse flex-col gap-5">
        <div className="h-14 w-52 rounded-lg bg-muted" />
        <div className="h-80 rounded-lg bg-muted" />
        <div className="h-36 rounded-lg bg-muted" />
      </section>
    );
  }

  if (schoolQuery.isError) {
    return (
      <Card className="mx-auto w-full max-w-4xl">
        <CardHeader>
          <CardTitle>Unable to load school settings</CardTitle>
          <CardDescription>
            {schoolQuery.error instanceof Error
              ? schoolQuery.error.message
              : 'Try refreshing the page.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <SchoolSettingsContent school={schoolQuery.data} />;
}
