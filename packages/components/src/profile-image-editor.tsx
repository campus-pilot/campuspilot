'use client';

import { useRef, useState } from 'react';
import { PROFILE_IMAGE_MIME_TYPES } from '@campuspilot/auth/profile-image.constants';
import type { ProfileImageUploadOptions } from '@campuspilot/auth/profile-image.client';
import { useForm } from '@tanstack/react-form';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@campuspilot/ui/components/avatar';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { Progress } from '@campuspilot/ui/components/progress';
import { ImageUp, LoaderCircle, Pencil } from 'lucide-react';
import { z } from 'zod';

import { Dropzone, formatFileSize } from './dropzone';

function imageFormSchema(subject: string) {
  return z.object({
    image: z
      .instanceof(File, { message: `Choose a ${subject} to upload.` })
      .refine(
        (file) => PROFILE_IMAGE_MIME_TYPES.some((type) => type === file.type),
        { message: 'Choose a JPEG, PNG, or WebP image.' },
      ),
  });
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function ErrorMessages({ errors }: { errors: unknown[] }) {
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

export function ProfileImageEditor({
  imageUrl,
  name,
  onUpload,
  subject = 'profile image',
  label = 'Profile image',
  description = 'JPEG, PNG, or WebP. Images are resized and compressed before upload.',
  canEdit = true,
}: {
  imageUrl?: string | null;
  name: string;
  onUpload?: (file: File, options: ProfileImageUploadOptions) => Promise<void>;
  subject?: string;
  label?: string;
  description?: string;
  canEdit?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>();
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const formSchema = imageFormSchema(subject);
  const form = useForm({
    defaultValues: { image: null as File | null },
    validators: {
      onChange: formSchema,
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      if (!value.image || !onUpload) return;

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setUploadProgress(undefined);
      try {
        await onUpload(value.image, {
          signal: abortController.signal,
          onProgress: setUploadProgress,
        });
        form.reset();
        setUploadProgress(undefined);
        setIsOpen(false);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
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
                : `Unable to upload the ${subject}.`,
            fields: {},
          },
        });
      } finally {
        abortControllerRef.current = undefined;
      }
    },
  });

  /** Cancels an active XHR before allowing the upload dialog to close. */
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
    <div className="flex items-center gap-4">
      <button
        type="button"
        className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={`Change ${subject}`}
        disabled={!canEdit}
        onClick={() => setIsOpen(true)}
      >
        <Avatar className="size-20!">
          {imageUrl ? (
            <AvatarImage key={imageUrl} src={imageUrl} alt="" />
          ) : null}
          <AvatarFallback className="text-lg">{initials(name)}</AvatarFallback>
        </Avatar>
        {canEdit ? <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Pencil aria-hidden />
          <span className="sr-only">Change {subject}</span>
        </span> : null}
      </button>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {description}
        </p>
        {canEdit ? <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setIsOpen(true)}
        >
          <ImageUp /> Change image
        </Button> : null}
      </div>
      {canEdit ? <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload {subject}</DialogTitle>
            <DialogDescription>
              The image is processed locally and stored privately in
              CampusPilot.
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
                <form.Field name="image">
                  {(field) => (
                    <div className="flex flex-col gap-2">
                      <Dropzone
                        key={
                          field.state.value
                            ? `${field.state.value.name}-${field.state.value.lastModified}`
                            : 'empty-profile-image'
                        }
                        name={field.name}
                        accept={PROFILE_IMAGE_MIME_TYPES.join(',')}
                        aria-label={label}
                        icon={ImageUp}
                        title={
                          field.state.value
                            ? field.state.value.name
                            : `Drop your ${subject} here`
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
                      <ErrorMessages errors={field.state.meta.errors} />
                    </div>
                  )}
                </form.Field>
              )}
            </form.Subscribe>
            <form.Subscribe
              selector={(state) => ({
                canSubmit: state.canSubmit,
                errors: state.errors,
                image: state.values.image,
                isSubmitting: state.isSubmitting,
              })}
            >
              {({ canSubmit, errors, image, isSubmitting }) => (
                <div className="flex flex-col gap-4">
                  {isSubmitting ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
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
                  <ErrorMessages errors={errors} />
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
                      disabled={!image || !canSubmit || isSubmitting}
                    >
                      {isSubmitting ? (
                        <LoaderCircle className="animate-spin" aria-hidden />
                      ) : (
                        <ImageUp aria-hidden />
                      )}
                      {isSubmitting ? 'Uploading…' : 'Upload image'}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </form.Subscribe>
          </form>
        </DialogContent>
      </Dialog> : null}
    </div>
  );
}
