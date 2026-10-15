'use client';
import {
  useId,
  type ReactNode,
  type ComponentProps,
  type FormEvent,
} from 'react';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';

export const controlClass = 'min-h-11 text-base md:text-base';
export function ExamButton(props: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      className={`${controlClass} h-auto max-w-full whitespace-normal px-4 py-2 ${props.className ?? ''}`}
    />
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`rounded-lg border p-3 text-sm ${error ? 'border-destructive/40 text-destructive' : 'bg-muted/40'}`}
    >
      {children}
    </div>
  );
}
export function Issues({ errors }: { errors: readonly unknown[] }) {
  const messages = errors.flatMap((error) => {
    if (typeof error === 'string') return [error];
    if (error && typeof error === 'object' && 'message' in error)
      return [String(error.message)];
    if (error && typeof error === 'object' && 'form' in error)
      return [String(error.form)];
    return [];
  });
  return (
    <>
      {[...new Set(messages)].map((message) => (
        <p key={message} className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ))}
    </>
  );
}
export type TextFieldApi = {
  name: string;
  state: { value: string; meta: { errors: readonly unknown[] } };
  handleChange: (value: string) => void;
  handleBlur: () => void;
};
export function ExamInput({
  field,
  label,
  ...props
}: { field: TextFieldApi; label: string } & Omit<
  ComponentProps<typeof Input>,
  'value' | 'onChange'
>) {
  const uniqueId = useId();
  const id = `exam-${uniqueId}`;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="break-words text-sm font-medium">
        {label}
      </label>
      <Input
        {...props}
        id={id}
        name={field.name}
        className={controlClass}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={field.state.meta.errors.length > 0}
        aria-describedby={`${id}-errors`}
      />
      <div id={`${id}-errors`}>
        <Issues errors={field.state.meta.errors} />
      </div>
    </div>
  );
}
export function ExamSelect({
  label,
  value,
  onChange,
  children,
  disabled = false,
  errors = [],
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  errors?: readonly unknown[];
  name?: string;
}) {
  const id = useId();
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
      {label}
      <select
        className="min-h-11 min-w-0 rounded-md border bg-background px-3 text-base"
        value={value}
        name={name}
        aria-invalid={errors.length > 0}
        aria-describedby={`${id}-errors`}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <span id={`${id}-errors`}>
        <Issues errors={errors} />
      </span>
    </label>
  );
}
export function LoadingExam() {
  return (
    <div
      role="status"
      aria-label="Loading examination"
      className="flex flex-col gap-4 motion-safe:animate-pulse"
    >
      <div className="h-16 rounded-xl bg-muted" />
      <div className="h-44 rounded-xl bg-muted" />
      <div className="h-44 rounded-xl bg-muted" />
    </div>
  );
}
export function ReadError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => unknown;
}) {
  return (
    <Notice error>
      {error instanceof Error
        ? error.message
        : 'Unable to load this information.'}{' '}
      <ExamButton
        type="button"
        variant="outline"
        onClick={() => {
          void retry();
        }}
      >
        Retry
      </ExamButton>
    </Notice>
  );
}
export function ExamPager({
  page,
  pages,
  total,
  onPage,
  disabled = false,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
  disabled?: boolean;
  errors?: readonly unknown[];
  name?: string;
}) {
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <span className="text-sm text-muted-foreground">
        {total === 0 ? 'No items' : `Page ${page} of ${pages} · ${total} items`}
      </span>
      <div className="flex gap-2">
        <ExamButton
          variant="outline"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </ExamButton>
        <ExamButton
          variant="outline"
          disabled={disabled || page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </ExamButton>
      </div>
    </nav>
  );
}

export function submitExam(
  event: FormEvent<HTMLFormElement>,
  submit: () => Promise<unknown>,
) {
  event.preventDefault();
  const element = event.currentTarget;
  void submit().then(() => focusInvalidExamField(element));
}

export function ExamPageFrame({
  title,
  description,
  back,
  children,
}: {
  title: string;
  description: string;
  back?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-5 pb-10">
      {back}
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="break-words text-2xl font-semibold">{title}</h1>
        <p className="break-words text-sm text-muted-foreground">
          {description}
        </p>
      </header>
      {children}
    </div>
  );
}

/** Opens a collapsed optional section before moving focus to its first invalid field. */
export function focusInvalidExamField(form: HTMLFormElement | null) {
  requestAnimationFrame(() => {
    const input = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const details = input?.closest('details');
    if (details) details.open = true;
    input?.focus();
  });
}
