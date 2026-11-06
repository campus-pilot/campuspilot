'use client';

import { SCHOOL_LOGO_MIME_TYPES } from '@campuspilot/api/routers/system-admin/school/school.constants';
import { Dropzone, formatFileSize } from '@campuspilot/components/dropzone';
import { OptionSelect } from '@campuspilot/components/option-select';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { Label } from '@campuspilot/ui/components/label';
import { ImageUp } from 'lucide-react';

export type DemoClassOption = { slug: string; label: string; displayOrder: number };

export function FieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : typeof error === 'string'
          ? error
          : undefined;
    return message ? (
      <p key={`${message}-${index}`} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;
  });
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2026, index, 1)),
}));

/** Billing cycle start month; values are `'1'`–`'12'`. */
export function MonthSelect({
  id,
  value,
  onValueChange,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <OptionSelect
      value={value}
      options={MONTH_OPTIONS}
      onValueChange={onValueChange}
      triggerProps={{ id, className: 'w-full' }}
    />
  );
}

/** Multi-select of the demo class catalogue; all classes start selected. */
export function DemoClassPicker({
  catalogue,
  value,
  onChange,
}: {
  catalogue: DemoClassOption[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const allSelected = value.length === catalogue.length;
  const toggle = (slug: string, checked: boolean) =>
    onChange(checked ? [...value, slug] : value.filter((item) => item !== slug));

  return (
    <fieldset className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <legend className="text-sm font-medium">
          Classes ({value.length} of {catalogue.length})
        </legend>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(allSelected ? [] : catalogue.map((item) => item.slug))}
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {catalogue.map((item) => (
          <Label key={item.slug} className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={value.includes(item.slug)}
              onCheckedChange={(checked) => toggle(item.slug, checked === true)}
            />
            {item.label}
          </Label>
        ))}
      </div>
    </fieldset>
  );
}

/** Optional logo; a generated monogram is used when none is chosen. */
export function DemoLogoField({
  value,
  disabled,
  onBlur,
  onChange,
}: {
  value: File | null;
  disabled: boolean;
  onBlur: () => void;
  onChange: (file: File | null) => void;
}) {
  return (
    <Dropzone
      key={value ? `${value.name}-${value.lastModified}` : 'empty-logo'}
      name="logo"
      accept={SCHOOL_LOGO_MIME_TYPES.join(',')}
      aria-label="Demo school logo"
      icon={ImageUp}
      title={value ? value.name : 'Logo (optional)'}
      description={value ? 'Click to choose another image' : 'A monogram is generated if you skip this'}
      footer={
        <span className="text-xs text-muted-foreground">
          {value ? formatFileSize(value.size) : 'JPEG, PNG, or WebP'}
        </span>
      }
      disabled={disabled}
      onBlur={onBlur}
      onFileSelect={(files) => onChange(files[0] ?? null)}
      onFilesRejected={(files) => onChange(files[0] ?? null)}
    />
  );
}
