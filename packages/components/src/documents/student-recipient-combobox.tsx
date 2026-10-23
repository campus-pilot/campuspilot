"use client";
import { useRef } from "react";
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxValue,
  ComboboxTrigger,
  useComboboxAnchor,
} from "@campuspilot/ui/components/combobox";
import { DocumentButton, DocumentErrors } from "./document-controls";

export type StudentRecipient = {
  id: string;
  name: string;
  admissionNo: string;
};

/** Remote filtering and pagination belong to the caller. Selected recipients
 * remain explicit values even when they are absent from the current page. The
 * popup stays inside this component's DOM container so it remains interactive
 * when the picker is mounted within a Radix modal dialog.
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
  const anchor = useComboboxAnchor();
  const popupContainer = useRef<HTMLDivElement>(null);
  return (
    <div ref={popupContainer} className="flex flex-col gap-2">
      <label htmlFor="document-students" className="text-sm font-medium">
        Find students
      </label>
      <Combobox
        multiple
        items={props.options}
        value={props.selected}
        filter={null}
        inputValue={props.search}
        onInputValueChange={props.onSearch}
        itemToStringLabel={(item: StudentRecipient) => item.name}
        itemToStringValue={(item: StudentRecipient) => item.id}
        isItemEqualToValue={(a, b) => a.id === b.id}
        onValueChange={props.onChange}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(values: StudentRecipient[]) =>
              values.map((value) => (
                <ComboboxChip
                  key={value.id}
                  aria-label={value.name}
                  removeLabel={`Remove ${value.name}`}
                >
                  {value.name}
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput
            id="document-students"
            placeholder="Search name or admission number…"
            onBlur={props.onBlur}
            aria-invalid={props.errors.length > 0}
            aria-describedby="document-students-help"
          />
          <ComboboxTrigger aria-label="Show students" />
        </ComboboxChips>
        <ComboboxContent anchor={anchor} container={popupContainer}>
          <ComboboxList>
            {props.options.map((item) => (
              <ComboboxItem
                key={item.id}
                value={item}
                className="pr-8"
                disabled={
                  props.selected.length >= 500 &&
                  !props.selected.some((value) => value.id === item.id)
                }
              >
                <span className="flex flex-col">
                  <span>{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.admissionNo}
                  </span>
                </span>
              </ComboboxItem>
            ))}
          </ComboboxList>
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
        </ComboboxContent>
      </Combobox>
      <p id="document-students-help" className="text-xs text-muted-foreground">
        {props.selected.length} selected · Choose up to 500 students across
        searches and pages.
      </p>
      <DocumentErrors errors={props.errors} />
    </div>
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
