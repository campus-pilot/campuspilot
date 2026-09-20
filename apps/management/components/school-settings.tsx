'use client';

import { useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { SchoolDetailsDto } from '@campuspilot/api/routers/school/school.dto';
import { SCHOOL_LOGO_MIME_TYPES } from '@campuspilot/api/routers/system-admin/school/school.constants';
import { Dropzone, formatFileSize } from '@campuspilot/components/dropzone';
import { Button } from '@campuspilot/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
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
import { ImageUp, LoaderCircle, Pencil } from 'lucide-react';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { uploadSchoolLogo } from '@/lib/school-image';
import { RequirePermissions } from './require-permissions';
import { SchoolAvatar } from './school-avatar';

const schoolDetailsFormSchema = z.object({
  name: z.string().trim().min(1, 'School name is required.'),
  slug: z
    .string()
    .trim()
    .min(1, 'School slug is required.')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens.'),
  location: z.string().trim().min(1, 'Location is required.'),
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

function SchoolDetailsPreview({ school }: { school: SchoolDetailsDto }) {
  return (
    <dl className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
      {[
        ['Name', school.name],
        ['Slug', school.slug],
        ['Location', school.location],
        ['Registration number', school.registrationNo ?? 'Not provided'],
      ].map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="truncate text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SchoolDetailsForm({ school }: { school: SchoolDetailsDto }) {
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
        const updated = await client.school.updateSchool({
          schoolId: school.id,
          ...value,
          registrationNo: value.registrationNo || null,
        });
        queryClient.setQueryData(
          orpc.school.getSchool.queryKey({ input: { schoolId: school.id } }),
          updated,
        );
        await queryClient.invalidateQueries({
          queryKey: orpc.school.listMySchools.queryKey(),
        });
        form.reset({
          name: updated.name,
          slug: updated.slug,
          location: updated.location,
          registrationNo: updated.registrationNo ?? '',
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
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
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
              {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

function SchoolLogoEditor({ school }: { school: SchoolDetailsDto }) {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>();
  const form = useForm({
    defaultValues: { logo: null as File | null },
    validators: { onChange: schoolLogoFormSchema, onSubmit: schoolLogoFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      if (!value.logo) return;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setUploadProgress(undefined);
      try {
        const updated = await uploadSchoolLogo(school.id, value.logo, {
          signal: abortController.signal,
          onProgress: setUploadProgress,
        });
        queryClient.setQueryData(
          orpc.school.getSchool.queryKey({ input: { schoolId: school.id } }),
          updated,
        );
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.school.getLogo.queryKey({
              input: { schoolId: school.id },
            }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.school.listMySchools.queryKey(),
          }),
        ]);
        form.reset();
        setIsOpen(false);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
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
        setUploadProgress(undefined);
      }
    },
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && form.state.isSubmitting) {
      abortControllerRef.current?.abort();
      return;
    }
    if (!nextOpen) form.reset();
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
          <Pencil />
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
            <form.Field name="logo">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Dropzone
                    key={field.state.value?.name ?? 'empty-logo'}
                    name={field.name}
                    accept={SCHOOL_LOGO_MIME_TYPES.join(',')}
                    title={field.state.value?.name ?? 'Drop your logo here'}
                    description="or click to choose an image"
                    icon={ImageUp}
                    footer={
                      <span className="text-xs text-muted-foreground">
                        {field.state.value
                          ? formatFileSize(field.state.value.size)
                          : 'JPEG, PNG, or WebP'}
                      </span>
                    }
                    disabled={form.state.isSubmitting}
                    onBlur={field.handleBlur}
                    onFileSelect={(files) => field.handleChange(files[0] ?? null)}
                    onFilesRejected={(files) =>
                      field.handleChange(files[0] ?? null)
                    }
                  />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
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
                  {isSubmitting ? <Progress value={uploadProgress ?? 0} /> : null}
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

function SchoolSettingsContent({ school }: { school: SchoolDetailsDto }) {
  const resource = { kind: 'school' as const, schoolId: school.id };

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">School settings</h1>
        <p className="text-sm text-muted-foreground">
          View school identity, organization details, and branding.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>School details</CardTitle>
          <CardDescription>
            Principals and managers can update these details.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <RequirePermissions
            permissions={{ action: SCHOOL_ACTIONS.UPDATE_LOGO, resource }}
            fallback={<SchoolAvatar school={school} className="size-28!" />}
          >
            <SchoolLogoEditor school={school} />
          </RequirePermissions>
          <RequirePermissions
            permissions={{ action: SCHOOL_ACTIONS.UPDATE_DETAILS, resource }}
            fallback={<SchoolDetailsPreview school={school} />}
          >
            <SchoolDetailsForm key={school.id} school={school} />
          </RequirePermissions>
        </CardContent>
      </Card>
    </section>
  );
}

export function SchoolSettings({ schoolId }: { schoolId: string }) {
  const schoolQuery = useQuery(
    orpc.school.getSchool.queryOptions({ input: { schoolId } }),
  );

  if (schoolQuery.isPending) {
    return (
      <section className="mx-auto flex w-full max-w-4xl animate-pulse flex-col gap-5">
        <div className="h-14 w-52 rounded-lg bg-muted" />
        <div className="h-80 rounded-lg bg-muted" />
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
