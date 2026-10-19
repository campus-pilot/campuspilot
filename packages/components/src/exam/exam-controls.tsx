'use client';
import {
  useId,
  type ReactNode,
  type ComponentProps,
  type FormEvent,
} from 'react';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import {
  OptionSelect,
  type OptionSelectOption,
} from '../option-select';

export function ExamButton(props: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      type={props.type ?? 'button'}
      className={props.className}
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
  options,
  disabled = false,
  errors = [],
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly OptionSelectOption[];
  disabled?: boolean;
  errors?: readonly unknown[];
  name?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      <OptionSelect
        value={value}
        options={options}
        name={name}
        disabled={disabled}
        onValueChange={onChange}
        triggerProps={{
          id,
          className: 'w-full',
          'aria-invalid': errors.length > 0,
          'aria-describedby': `${id}-errors`,
        }}
      />
      <span id={`${id}-errors`}>
        <Issues errors={errors} />
      </span>
    </div>
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
  children,
  level = 'h1',
}: {
  title: string;
  description: string;
  children: ReactNode;
  level?: 'h1' | 'h2';
}) {
  const Heading = level;
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-4">
      <header className="flex min-w-0 flex-col gap-1">
        <Heading
          className={`break-words font-semibold tracking-tight ${level === 'h1' ? 'text-2xl' : 'text-lg'}`}
        >
          {title}
        </Heading>
        {description && (
          <p className="break-words text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </header>
      {children}
    </div>
  );
}

/** Opens optional sections and focuses the first visible invalid control.
 * Responsive editors can render both grid and card controls; hidden breakpoint
 * variants must never capture validation focus.
 */
export function focusInvalidExamField(form: HTMLFormElement | null) {
  requestAnimationFrame(() => {
    for (const input of form?.querySelectorAll<HTMLElement>(
      '[aria-invalid="true"]',
    ) ?? []) {
      const details = input.closest('details');
      if (details) details.open = true;
      if (!input.getClientRects().length) continue;
      input.focus();
      break;
    }
  });
}
