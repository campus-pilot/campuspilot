'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createOwnSchoolInputSchema } from '@campuspilot/api/routers/school-creation/school-creation.dto';
import { SCHOOL_LOGO_MIME_TYPES } from '@campuspilot/api/routers/system-admin/school/school.constants';
import { Dropzone, formatFileSize } from '@campuspilot/components/dropzone';
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
import { Progress } from '@campuspilot/ui/components/progress';
import { toast } from '@campuspilot/ui/lib/toast';
import { ImageUp, Plus } from 'lucide-react';
import { z } from 'zod';
import { FormErrors } from '@/components/form-errors';
import { client, orpc } from '@/lib/orpc';
import { prepareSchoolLogo, uploadPreparedSchoolLogo } from '@/lib/school-image';
import { storeSchoolId } from '../school-selection';
import { newSchoolWelcomeHref } from './new-school-welcome';

const createSchoolFormSchema = z.object({
  name: createOwnSchoolInputSchema.shape.name,
  location: createOwnSchoolInputSchema.shape.location,
  registrationNo: z.string().trim().max(60),
  logo: z
    .instanceof(File, { message: 'Choose a logo for the school.' })
    .refine((file) => SCHOOL_LOGO_MIME_TYPES.some((type) => type === file.type), {
      message: 'Choose a JPEG, PNG, or WebP image.',
    }),
});

type TextFieldName = 'name' | 'location' | 'registrationNo';

/**
 * Creates the school, uploads its logo and opens it with the welcome dialog.
 *
 * The logo is checked and compressed before the school is created, so an
 * image the browser cannot use is refused without leaving a school behind.
 * The upload itself can only follow the creation (it needs the school), so
 * if it fails the school still opens and the person is told to add the logo
 * from the Organization settings; the creation is not undone, since the
 * allowance it used would not come back (docs/school-creation.md).
 */
function useCreateSchoolForm(onUploadProgress: (percentage: number | undefined) => void) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useForm({
    defaultValues: { name: '', location: '', registrationNo: '', logo: null as File | null },
    validators: { onSubmit: createSchoolFormSchema },
    onSubmit: async ({ value, formApi }) => {
      formApi.setErrorMap({});
      if (!value.logo) return;
      let logo: File;
      try {
        logo = await prepareSchoolLogo(value.logo);
      } catch (error) {
        formApi.setFieldMeta('logo', (meta) => ({
          ...meta,
          errorMap: { onSubmit: { message: error instanceof Error ? error.message : 'Unable to read this image.' } },
        }));
        return;
      }
      let schoolId: string;
      try {
        ({ schoolId } = await client.schoolCreation.createSchool({
          name: value.name,
          location: value.location,
          registrationNo: value.registrationNo || null,
        }));
      } catch (error) {
        // A refusal (for example the allowance used up in another tab) is
        // shown here; the status query is read again so the screen follows.
        void queryClient.invalidateQueries({ queryKey: orpc.schoolCreation.getStatus.key() });
        formApi.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to create the school.', fields: {} },
        });
        return;
      }
      try {
        onUploadProgress(0);
        await uploadPreparedSchoolLogo(schoolId, logo, { onProgress: onUploadProgress });
      } catch {
        toast.error(`${value.name.trim()} was created, but its logo could not be uploaded. Add it from Organization settings.`);
      } finally {
        onUploadProgress(undefined);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.school.listMySchools.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.schoolCreation.getStatus.key() }),
      ]);
      storeSchoolId(schoolId);
      router.push(newSchoolWelcomeHref(schoolId));
    },
  });
}

type CreateSchoolForm = ReturnType<typeof useCreateSchoolForm>;

function TextField({
  form,
  name,
  label,
  placeholder,
}: {
  form: CreateSchoolForm;
  name: TextFieldName;
  label: string;
  placeholder: string;
}) {
  return (
    <form.Field name={name}>
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`create-school-${name}`}>{label}</Label>
          <Input
            id={`create-school-${name}`}
            placeholder={placeholder}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <FormErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function LogoField({ form }: { form: CreateSchoolForm }) {
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => <LogoInput form={form} disabled={isSubmitting} />}
    </form.Subscribe>
  );
}

/** The logo picker; `disabled` comes from a subscription so it follows the submission as it starts and ends. */
function LogoInput({ form, disabled }: { form: CreateSchoolForm; disabled: boolean }) {
  return (
    <form.Field name="logo">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="create-school-logo">School logo</Label>
          <Dropzone
            key={field.state.value?.name ?? 'empty-logo'}
            id="create-school-logo"
            name={field.name}
            accept={SCHOOL_LOGO_MIME_TYPES.join(',')}
            title={field.state.value?.name ?? 'Drop your logo here'}
            description="or click to choose an image"
            icon={ImageUp}
            footer={
              <span className="text-xs text-muted-foreground">
                {field.state.value ? formatFileSize(field.state.value.size) : 'JPEG, PNG, or WebP'}
              </span>
            }
            disabled={disabled}
            onBlur={field.handleBlur}
            onFileSelect={(files) => field.handleChange(files[0] ?? null)}
            onFilesRejected={(files) => field.handleChange(files[0] ?? null)}
          />
          <FormErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function SubmitError({ form }: { form: CreateSchoolForm }) {
  return (
    <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
      {(error) =>
        error && typeof error === 'object' && 'form' in error ? (
          <p role="alert" className="text-xs text-destructive">
            {String(error.form)}
          </p>
        ) : null
      }
    </form.Subscribe>
  );
}

function CreateSchoolFooter({
  form,
  uploadProgress,
  onCancel,
}: {
  form: CreateSchoolForm;
  uploadProgress: number | undefined;
  onCancel: () => void;
}) {
  return (
    <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
      {({ canSubmit, isSubmitting }) => (
        <div className="flex flex-col gap-4">
          {uploadProgress === undefined ? null : <Progress value={uploadProgress} aria-label="Logo upload" />}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {!isSubmitting ? 'Create school' : uploadProgress === undefined ? 'Creating…' : 'Uploading logo…'}
            </Button>
          </DialogFooter>
        </div>
      )}
    </form.Subscribe>
  );
}

/**
 * The create-school form inside its dialog: name, location, an optional
 * registration number and the logo. What the school starts with (the trial)
 * is told in the welcome dialog once it is open, so the form stays short.
 * The dialog cannot be closed while the school is being created, so the
 * person always sees where it ends.
 */
function CreateSchoolDialogContent({ onClose }: { onClose: () => void }) {
  const [uploadProgress, setUploadProgress] = useState<number>();
  const form = useCreateSchoolForm(setUploadProgress);
  return (
    <DialogContent
      onEscapeKeyDown={(event) => {
        if (form.state.isSubmitting) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (form.state.isSubmitting) event.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>Create a school</DialogTitle>
        <DialogDescription>You become its owner and principal.</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <TextField form={form} name="name" label="School name" placeholder="Sunrise Public School" />
        <TextField form={form} name="location" label="Location" placeholder="City, state" />
        <TextField form={form} name="registrationNo" label="Registration number (optional)" placeholder="As issued by the board" />
        <LogoField form={form} />
        <SubmitError form={form} />
        <CreateSchoolFooter form={form} uploadProgress={uploadProgress} onCancel={onClose} />
      </form>
    </DialogContent>
  );
}

/**
 * The "Create a school" button and its dialog. The dialog's content mounts
 * only while it is open, so every opening starts from an empty form.
 */
export function CreateSchoolDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Create a school
      </Button>
      {open ? <CreateSchoolDialogContent onClose={() => setOpen(false)} /> : null}
    </Dialog>
  );
}
