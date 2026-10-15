'use client';
import { useId, type ReactNode, type ComponentProps } from 'react';
import { Button } from '@campuspilot/ui/components/button';
import {
  FileText,
  Fingerprint,
  CalendarDays,
  GraduationCap,
  ScanEye,
} from 'lucide-react';
export type DocumentKind =
  'report_card' | 'id_card' | 'admit_card' | 'timetable';
export const documentKinds = [
  {
    value: 'report_card',
    label: 'Report cards',
    description: 'Approved marks and grades',
    icon: GraduationCap,
  },
  {
    value: 'id_card',
    label: 'Student IDs',
    description: 'Print-ready identity cards',
    icon: Fingerprint,
  },
  {
    value: 'admit_card',
    label: 'Admit cards',
    description: 'Identity and exam schedule',
    icon: FileText,
  },
  {
    value: 'timetable',
    label: 'Timetables',
    description: 'A clear examination schedule',
    icon: CalendarDays,
  },
] as const;
export function DocumentButton(props: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      className={`min-h-10 h-auto gap-2 whitespace-normal px-4 py-2 text-sm ${props.className ?? ''}`}
    />
  );
}
export function DocumentKindPicker({
  value,
  onChange,
}: {
  value: DocumentKind;
  onChange: (value: DocumentKind) => void;
}) {
  return (
    <div
      aria-label="Document type"
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {documentKinds.map((item) => (
        <button
          type="button"
          key={item.value}
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
          className={`flex min-h-24 items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${value === item.value ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'bg-card hover:bg-muted/40'}`}
        >
          <item.icon
            className={`mt-0.5 size-5 shrink-0 ${value === item.value ? 'text-primary' : 'text-muted-foreground'}`}
          />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{item.label}</span>
            <span className="text-xs text-muted-foreground">
              {item.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
export function DocumentPanel({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-5 rounded-xl border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
export function DocumentPreview({
  html,
  label = 'Document preview',
  sample = false,
}: {
  html?: string;
  label?: string;
  sample?: boolean;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-muted/30">
      <header className="flex items-center justify-between gap-3 border-b bg-card px-5 py-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ScanEye className="size-4" />
          {label}
        </span>
        {sample && (
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            Sample data
          </span>
        )}
      </header>
      {html ? (
        <iframe
          title={label}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={html}
          className="h-[640px] w-full border-0 bg-white"
        />
      ) : (
        <div className="flex min-h-96 flex-col items-center justify-center gap-3 px-6 text-center">
          <FileText className="size-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Your preview will appear here.
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Choose a template or preview a document to see the finished layout.
          </p>
        </div>
      )}
    </section>
  );
}
export function DocumentNotice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'bg-muted/40 text-muted-foreground'}`}
    >
      {children}
    </div>
  );
}
export function DocumentErrors({ errors }: { errors: readonly unknown[] }) {
  const messages = errors.flatMap((e) =>
    typeof e === 'string'
      ? [e]
      : e && typeof e === 'object' && 'message' in e
        ? [String(e.message)]
        : [],
  );
  return (
    <>
      {[...new Set(messages)].map((message) => (
        <p key={message} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ))}
    </>
  );
}
export type DocumentStringField = {
  name: string;
  state: { value: string; meta: { errors: readonly unknown[] } };
  handleChange: (value: string) => void;
  handleBlur: () => void;
};
export function DocumentField({
  field,
  label,
  multiline = false,
  code = false,
  description,
  disabled = false,
}: {
  field: DocumentStringField;
  label: string;
  multiline?: boolean;
  code?: boolean;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const props = {
    id,
    name: field.name,
    value: field.state.value,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => field.handleChange(event.target.value),
    onBlur: field.handleBlur,
    disabled,
    'aria-invalid': field.state.meta.errors.length > 0,
    'aria-describedby': `${id}-help`,
    className: `min-h-11 w-full rounded-lg border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-primary ${code ? 'min-h-80 font-mono text-xs' : ''}`,
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea {...props} rows={code ? 18 : 3} spellCheck={!code} />
      ) : (
        <input {...props} />
      )}
      <div id={`${id}-help`}>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        <DocumentErrors errors={field.state.meta.errors} />
      </div>
    </div>
  );
}
export function DocumentSelect({
  field,
  label,
  children,
  disabled = false,
}: {
  field: DocumentStringField;
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        disabled={disabled}
        aria-invalid={field.state.meta.errors.length > 0}
        aria-describedby={`${id}-errors`}
        className="min-h-11 min-w-0 rounded-lg border bg-background px-3 text-sm"
      >
        {children}
      </select>
      <div id={`${id}-errors`}>
        <DocumentErrors errors={field.state.meta.errors} />
      </div>
    </div>
  );
}
