"use client";
import { useId, type ReactNode, type ComponentProps } from "react";
import { Input } from "@campuspilot/ui/components/input";
import { Textarea } from "@campuspilot/ui/components/textarea";
import { Checkbox } from "@campuspilot/ui/components/checkbox";
import { Button } from "@campuspilot/ui/components/button";
import {
  OptionSelect,
  type OptionSelectOption,
} from "../option-select";
import {
  Check,
  FileText,
  Fingerprint,
  CalendarDays,
  GraduationCap,
  ScanEye,
  ReceiptText,
  CreditCard,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
export type DocumentKind =
  "report_card" | "id_card" | "admit_card" | "timetable" | "bill" | "receipt" | "statement";
type DocumentKindItem = {
  value: DocumentKind;
  label: string;
  description: string;
  icon: LucideIcon;
};
export const documentKinds = [
  {
    value: "report_card",
    label: "Report cards",
    description: "Approved marks and grades",
    icon: GraduationCap,
  },
  {
    value: "id_card",
    label: "Student IDs",
    description: "Print-ready identity cards",
    icon: Fingerprint,
  },
  {
    value: "admit_card",
    label: "Admit cards",
    description: "Identity and exam schedule",
    icon: FileText,
  },
  {
    value: "timetable",
    label: "Timetables",
    description: "A clear examination schedule",
    icon: CalendarDays,
  },
] as const;
/** Session Documents exposes batch-friendly workflows. Statements remain
 * contextual to an admission ledger because they require an account cutoff. */
export const workspaceDocumentKinds = [
  ...documentKinds,
  { value: "bill", label: "Bills", description: "Posted fee charges", icon: CreditCard },
  { value: "receipt", label: "Receipts", description: "Posted payment receipts", icon: ReceiptText },
] as const;
export const allDocumentKinds = [
  ...documentKinds,
  { value: "bill", label: "Bills", description: "Posted fee charges", icon: CreditCard },
  { value: "receipt", label: "Receipts", description: "Payments and refunds", icon: ReceiptText },
  { value: "statement", label: "Statements", description: "Account activity as of a date", icon: ScrollText },
] as const;
export function DocumentButton(props: ComponentProps<typeof Button>) {
  return <Button {...props} type={props.type ?? "button"} />;
}
export function DocumentKindPicker({
  value,
  onChange,
}: {
  value: DocumentKind;
  onChange: (value: DocumentKind) => void;
}) {
  const id = useId();
  const selected = documentKinds.find((item) => item.value === value)!;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-xs font-medium">
        Document type
      </label>
      <OptionSelect
        value={value}
        options={documentKinds}
        onValueChange={onChange}
        triggerProps={{ id, className: "w-full sm:max-w-xs" }}
      />
      <p className="text-xs text-muted-foreground">{selected.description}</p>
    </div>
  );
}

/** Cards expose the available document workflows at once. Supplying `value`
 * makes them a persistent radio selection; omitting it makes each card a launch
 * button for a caller-owned workflow such as a dialog.
 */
export function DocumentKindCards({
  value,
  onChange,
  items = documentKinds,
}: {
  value?: DocumentKind;
  onChange: (value: DocumentKind) => void;
  items?: readonly DocumentKindItem[];
}) {
  const isSelection = value !== undefined;
  return (
    <div
      role={isSelection ? "radiogroup" : "group"}
      aria-label="Document type"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role={isSelection ? "radio" : undefined}
            aria-checked={isSelection ? selected : undefined}
            onClick={() => onChange(item.value)}
            className={`flex min-w-0 items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary/50 bg-primary/[0.04]" : "bg-card"}`}
          >
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-lg ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              <item.icon className="size-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                {item.label}
                {selected ? <Check className="size-4 text-primary" aria-hidden /> : null}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {item.description}
              </span>
            </span>
          </button>
        );
      })}
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
/** Displays server-sanitized HTML without scripts, navigation, or inherited
 * origin privileges. Keep the sandbox empty; adding capabilities here weakens
 * both marketplace previews and the school template editor.
 */
export function DocumentPreview({
  html,
  label = "Document preview",
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
      role={error ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm ${error ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-muted/40 text-muted-foreground"}`}
    >
      {children}
    </div>
  );
}
export function DocumentErrors({ errors }: { errors: readonly unknown[] }) {
  const messages = errors.flatMap((e) =>
    typeof e === "string"
      ? [e]
      : e && typeof e === "object" && "message" in e
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
export type DocumentStringField<T extends string = string> = {
  name: string;
  state: { value: T; meta: { errors: readonly unknown[] } };
  handleChange: (value: T) => void;
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
    "aria-invalid": field.state.meta.errors.length > 0,
    "aria-describedby": `${id}-help`,
    className: code ? "min-h-64 font-mono text-xs" : "w-full",
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {multiline ? (
        <Textarea {...props} rows={code ? 18 : 3} spellCheck={!code} />
      ) : (
        <Input {...props} />
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
export function DocumentSelect<T extends string>({
  field,
  label,
  options,
  disabled = false,
}: {
  field: DocumentStringField<T>;
  label: string;
  options: readonly OptionSelectOption<T>[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <OptionSelect
        name={field.name}
        value={field.state.value}
        options={options}
        onValueChange={field.handleChange}
        disabled={disabled}
        triggerProps={{
          id,
          onBlur: field.handleBlur,
          'aria-invalid': field.state.meta.errors.length > 0,
          'aria-describedby': `${id}-errors`,
          className: "w-full min-w-0",
        }}
      />
      <div id={`${id}-errors`}>
        <DocumentErrors errors={field.state.meta.errors} />
      </div>
    </div>
  );
}

export function DocumentCheckbox({
  field,
  label,
}: {
  field: {
    name: string;
    state: { value: boolean; meta: { errors: readonly unknown[] } };
    handleChange: (value: boolean) => void;
    handleBlur: () => void;
  };
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-2 text-xs">
        <Checkbox
          id={id}
          name={field.name}
          checked={field.state.value}
          onCheckedChange={field.handleChange}
          onBlur={field.handleBlur}
          aria-invalid={field.state.meta.errors.length > 0}
        />
        {label}
      </label>
      <DocumentErrors errors={field.state.meta.errors} />
    </div>
  );
}
