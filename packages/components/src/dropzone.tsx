'use client';

import * as React from 'react';
import { Upload, type LucideIcon } from 'lucide-react';

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const unit = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(
    sizes.length - 1,
    Math.floor(Math.log(bytes) / Math.log(unit)),
  );
  return `${Number.parseFloat((bytes / unit ** unitIndex).toFixed(1))} ${sizes[unitIndex]}`;
}

/**
 * Mirrors native file-picker acceptance for files dropped directly onto the
 * component, including extensions, exact MIME types, and type wildcards.
 */
function isAccepted(file: File, accept: string | undefined): boolean {
  if (!accept) return true;

  return accept
    .split(',')
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean)
    .some((pattern) => {
      if (pattern.startsWith('.')) {
        return file.name.toLowerCase().endsWith(pattern);
      }
      if (pattern.endsWith('/*')) {
        return file.type.toLowerCase().startsWith(pattern.slice(0, -1));
      }
      return file.type.toLowerCase() === pattern;
    });
}

export interface DropzoneProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  footer?: React.ReactNode;
  onFileSelect?: (files: File[]) => void;
  onFilesRejected?: (files: File[]) => void;
  className?: string;
}

export const Dropzone = React.forwardRef<HTMLInputElement, DropzoneProps>(
  function Dropzone(
    {
      icon: Icon = Upload,
      title = 'Upload files',
      description = 'Drag and drop files here or click to browse',
      footer,
      onFileSelect,
      onFilesRejected,
      className,
      onChange,
      accept,
      multiple,
      disabled,
      ...inputProps
    },
    forwardedRef,
  ) {
    const [isDraggedOver, setIsDraggedOver] = React.useState(false);

    function setInputRef(node: HTMLInputElement | null) {
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }

    function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
      event.preventDefault();
      setIsDraggedOver(false);
      if (disabled) return;

      const droppedFiles = Array.from(event.dataTransfer.files);
      const acceptedFiles = droppedFiles.filter((file) =>
        isAccepted(file, accept),
      );
      const rejectedFiles = droppedFiles.filter(
        (file) => !isAccepted(file, accept),
      );

      if (rejectedFiles.length > 0) onFilesRejected?.(rejectedFiles);
      if (acceptedFiles.length > 0) {
        onFileSelect?.(multiple ? acceptedFiles : acceptedFiles.slice(0, 1));
      }
    }

    return (
      <label
        aria-disabled={disabled}
        data-slot="dropzone"
        className={[
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center transition-colors hover:border-muted-foreground/50 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30',
          isDraggedOver ? 'border-primary bg-accent/40' : undefined,
          disabled ? 'pointer-events-none opacity-50' : undefined,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        // Preventing the default drag behavior keeps the browser from
        // navigating away from the current form when a file is dropped.
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDraggedOver(true);
        }}
        onDragLeave={(event) => {
          if (
            event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            return;
          }
          setIsDraggedOver(false);
        }}
        onDrop={handleDrop}
      >
        <Icon className="mb-2 size-8 text-muted-foreground" aria-hidden />
        {title ? <p className="text-sm font-medium">{title}</p> : null}
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
        {footer ? <div className="mt-2">{footer}</div> : null}
        <input
          {...inputProps}
          ref={setInputRef}
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(event) => {
            onChange?.(event);
            if (event.target.files) {
              onFileSelect?.(Array.from(event.target.files));
            }
          }}
        />
      </label>
    );
  },
);
