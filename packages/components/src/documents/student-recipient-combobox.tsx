"use client";
import { Combobox } from "@campuspilot/ui/components/combobox";
import { DocumentButton, DocumentErrors } from "./document-controls";

export type StudentRecipient = {
  id: string;
  name: string;
  admissionNo: string;
};

/** The most recipients one document batch accepts. */
export const MAX_STUDENT_RECIPIENTS = 500;

/** Remote filtering and pagination belong to the caller. Selected recipients
 * remain explicit values even when they are absent from the current page.
 * Once {@link MAX_STUDENT_RECIPIENTS} are chosen, unselected options are
 * disabled; selected ones stay enabled so they can still be removed.
 */
export function StudentRecipientCombobox(props: {
  options: StudentRecipient[];
  selected: StudentRecipient[];
  search: string;
  onSearch: (value: string) => void;
  onChange: (value: StudentRecipient[]) => void;
  onBlur: () => void;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  page: number;
  totalPages: number;
  hasNext: boolean;
  onPage: (page: number) => void;
  errors: readonly unknown[];
}) {
  const atCap = props.selected.length >= MAX_STUDENT_RECIPIENTS;
  const selectedIds = new Set(props.selected.map((value) => value.id));
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="document-students" className="text-sm font-medium">
        Find students
      </label>
      <Combobox
        multiple
        id="document-students"
        items={props.options}
        value={props.selected}
        onValueChange={props.onChange}
        itemKey={(item) => item.id}
        itemLabel={(item) => item.name}
        renderItem={(item) => <RecipientOption item={item} />}
        isItemDisabled={(item) => atCap && !selectedIds.has(item.id)}
        removeLabel={(item) => `Remove ${item.name}`}
        search={props.search}
        onSearchChange={props.onSearch}
        onSearchBlur={props.onBlur}
        searchLabel="Search students"
        searchPlaceholder="Search name or admission number…"
        placeholder="Select students…"
        aria-invalid={props.errors.length > 0}
        aria-describedby="document-students-help"
        footer={<RecipientFooter {...props} />}
      />
      <p id="document-students-help" className="text-xs text-muted-foreground">
        {props.selected.length} selected · Choose up to{" "}
        {MAX_STUDENT_RECIPIENTS} students across searches and pages.
      </p>
      <DocumentErrors errors={props.errors} />
    </div>
  );
}
function RecipientOption({ item }: { item: StudentRecipient }) {
  return (
    <span className="flex flex-col">
      <span>{item.name}</span>
      <span className="text-xs text-muted-foreground">{item.admissionNo}</span>
    </span>
  );
}
function RecipientFooter(props: {
  options: StudentRecipient[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  page: number;
  totalPages: number;
  hasNext: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <>
      <RecipientStatus
        loading={props.loading}
        error={props.error}
        empty={!props.options.length}
        onRetry={props.onRetry}
      />
      <div className="flex items-center justify-between gap-2 border-t p-2">
        <DocumentButton
          type="button"
          variant="ghost"
          disabled={props.page <= 1 || props.loading}
          onClick={() => props.onPage(props.page - 1)}
        >
          Previous
        </DocumentButton>
        <span className="text-xs">
          {props.page} / {props.totalPages}
        </span>
        <DocumentButton
          type="button"
          variant="ghost"
          disabled={!props.hasNext || props.loading}
          onClick={() => props.onPage(props.page + 1)}
        >
          Next
        </DocumentButton>
      </div>
    </>
  );
}
function RecipientStatus({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading: boolean;
  error?: string;
  empty: boolean;
  onRetry: () => void;
}) {
  if (error)
    return (
      <div
        role="alert"
        className="flex items-center gap-2 p-3 text-sm text-destructive"
      >
        {error}
        <DocumentButton type="button" onClick={onRetry} variant="ghost">
          Retry
        </DocumentButton>
      </div>
    );
  if (loading || empty)
    return (
      <p role="status" className="p-3 text-sm text-muted-foreground">
        {loading ? "Loading students…" : "No students match your search."}
      </p>
    );
  return null;
}
