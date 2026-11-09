"use client"

import * as React from "react"
import { cn } from "cn"
import { ChevronDownIcon, XIcon } from "lucide-react"

import { Button } from "@campuspilot/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@campuspilot/ui/components/command"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@campuspilot/ui/components/popover"

type ComboboxBaseProps<T> = {
  /** The current result page. Filtering and paging belong to the caller. */
  items: readonly T[]
  /** Stable identity used for selection and as the cmdk item value. */
  itemKey: (item: T) => string
  /** Text shown for a selected value in the trigger or its chip. */
  itemLabel: (item: T) => string
  /** Option content; defaults to `itemLabel`. */
  renderItem?: (item: T) => React.ReactNode
  isItemDisabled?: (item: T) => boolean
  search: string
  onSearchChange: (search: string) => void
  onSearchBlur?: () => void
  /** Accessible name of the search input inside the popup. */
  searchLabel?: string
  searchPlaceholder?: string
  /** Trigger text when nothing is selected. */
  placeholder?: string
  /** Shown in the list when `items` is empty. */
  emptyMessage?: React.ReactNode
  /** Rendered below the list inside the popup, e.g. status or paging. */
  footer?: React.ReactNode
  id?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
  disabled?: boolean
  className?: string
}

type ComboboxSingleProps<T> = ComboboxBaseProps<T> & {
  multiple?: false
  value: T | null
  onValueChange: (value: T | null) => void
  /** Shows a button that clears the selection. */
  showClear?: boolean
  clearLabel?: string
}

type ComboboxMultipleProps<T> = ComboboxBaseProps<T> & {
  multiple: true
  value: readonly T[]
  onValueChange: (value: T[]) => void
  /** Accessible name of a chip's remove button. */
  removeLabel?: (item: T) => string
}

export type ComboboxProps<T> = ComboboxSingleProps<T> | ComboboxMultipleProps<T>

/**
 * Searchable select built on Radix Popover and cmdk.
 *
 * Search is always remote: cmdk filtering is disabled (`shouldFilter={false}`)
 * so every item the caller passes is shown, whatever the server matched on.
 * Selected values are rendered from `value`, never looked up in `items`, so a
 * selection stays visible while a search or page that excludes it is shown.
 *
 * Single select closes the popup after a choice; multiple select toggles the
 * chosen item and keeps the popup open. The popup is portalled by Radix, which
 * keeps it interactive and focusable inside a Radix modal Dialog.
 */
function Combobox<T>(props: ComboboxMultipleProps<T>): React.JSX.Element
function Combobox<T>(props: ComboboxSingleProps<T>): React.JSX.Element
function Combobox<T>(props: ComboboxProps<T>) {
  const [open, setOpen] = React.useState(false)
  const selectedKeys = new Set(selectedValues(props).map(props.itemKey))
  const select = (item: T) => {
    if (!props.multiple) {
      props.onValueChange(item)
      setOpen(false)
      return
    }
    const key = props.itemKey(item)
    props.onValueChange(
      selectedKeys.has(key)
        ? props.value.filter((value) => props.itemKey(value) !== key)
        : [...props.value, item]
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ComboboxField {...props} open={open} />
      <ComboboxPanel
        {...props}
        selectedKeys={selectedKeys}
        onSelect={select}
      />
    </Popover>
  )
}

function selectedValues<T>(props: ComboboxProps<T>): readonly T[] {
  if (props.multiple) return props.value
  return props.value === null ? [] : [props.value]
}

/** The always-visible field: chips (multiple), trigger and clear button. */
function ComboboxField<T>(props: ComboboxProps<T> & { open: boolean }) {
  return (
    <PopoverAnchor asChild>
      <div
        data-slot="combobox-field"
        data-disabled={props.disabled || undefined}
        className={cn(
          "flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-input/20 bg-clip-padding px-1 py-0.5 text-xs/relaxed transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 has-aria-invalid:border-destructive has-aria-invalid:ring-2 has-aria-invalid:ring-destructive/20 data-disabled:opacity-50 dark:bg-input/30 dark:has-aria-invalid:border-destructive/50 dark:has-aria-invalid:ring-destructive/40",
          props.className
        )}
      >
        {props.multiple && (
          <ComboboxChips
            values={props.value}
            itemKey={props.itemKey}
            itemLabel={props.itemLabel}
            removeLabel={props.removeLabel}
            disabled={props.disabled}
            onRemove={(key) =>
              props.onValueChange(
                props.value.filter((value) => props.itemKey(value) !== key)
              )
            }
          />
        )}
        <ComboboxTrigger {...props} />
        {!props.multiple && props.showClear && props.value !== null && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-slot="combobox-clear"
            aria-label={props.clearLabel ?? "Clear selection"}
            disabled={props.disabled}
            onClick={() => props.onValueChange(null)}
          >
            <XIcon aria-hidden />
          </Button>
        )}
      </div>
    </PopoverAnchor>
  )
}

/**
 * Opens the popup. It carries `role="combobox"`, so its accessible name comes
 * from `aria-label` or an associated `<label>`, not from the selected text.
 */
function ComboboxTrigger<T>(props: ComboboxProps<T> & { open: boolean }) {
  const label =
    !props.multiple && props.value !== null ? props.itemLabel(props.value) : null
  return (
    <PopoverTrigger asChild>
      <button
        type="button"
        role="combobox"
        id={props.id}
        aria-label={props["aria-label"]}
        aria-invalid={props["aria-invalid"]}
        aria-describedby={props["aria-describedby"]}
        aria-expanded={props.open}
        disabled={props.disabled}
        data-slot="combobox-trigger"
        className="flex h-6 min-w-16 flex-1 cursor-default items-center justify-between gap-2 rounded-sm px-1 text-left outline-none disabled:cursor-not-allowed"
      >
        <span className={cn("truncate", !label && "text-muted-foreground")}>
          {label ?? props.placeholder}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="pointer-events-none size-3.5 shrink-0 text-muted-foreground"
        />
      </button>
    </PopoverTrigger>
  )
}

function ComboboxChips<T>(props: {
  values: readonly T[]
  itemKey: (item: T) => string
  itemLabel: (item: T) => string
  removeLabel?: (item: T) => string
  disabled?: boolean
  onRemove: (key: string) => void
}) {
  return props.values.map((value) => (
    <ComboboxChip
      key={props.itemKey(value)}
      label={props.itemLabel(value)}
      removeLabel={
        props.removeLabel?.(value) ?? `Remove ${props.itemLabel(value)}`
      }
      disabled={props.disabled}
      onRemove={() => props.onRemove(props.itemKey(value))}
    />
  ))
}

function ComboboxChip(props: {
  label: string
  removeLabel: string
  disabled?: boolean
  onRemove: () => void
}) {
  return (
    <span
      data-slot="combobox-chip"
      className="flex h-[calc(--spacing(4.75))] w-fit items-center justify-center gap-1 rounded-[calc(var(--radius-sm)-2px)] bg-muted-foreground/10 pl-1.5 text-xs/relaxed font-medium whitespace-nowrap text-foreground"
    >
      {props.label}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={props.removeLabel}
        disabled={props.disabled}
        className="-ml-1 opacity-50 hover:opacity-100"
        onClick={props.onRemove}
      >
        <XIcon aria-hidden />
      </Button>
    </span>
  )
}

/** The popup: search input, options and the caller's footer. */
function ComboboxPanel<T>(
  props: ComboboxProps<T> & {
    selectedKeys: ReadonlySet<string>
    onSelect: (item: T) => void
  }
) {
  return (
    <PopoverContent
      align="start"
      data-slot="combobox-content"
      className="w-(--radix-popover-trigger-width) min-w-56 gap-0 p-0"
    >
      <Command shouldFilter={false} loop label={props.searchLabel ?? "Search"}>
        <CommandInput
          value={props.search}
          onValueChange={props.onSearchChange}
          onBlur={props.onSearchBlur}
          placeholder={props.searchPlaceholder ?? "Search…"}
        />
        <CommandList>
          {props.emptyMessage !== undefined && (
            <CommandEmpty>{props.emptyMessage}</CommandEmpty>
          )}
          {props.items.map((item) => (
            <ComboboxOption
              key={props.itemKey(item)}
              value={props.itemKey(item)}
              selected={props.selectedKeys.has(props.itemKey(item))}
              disabled={props.isItemDisabled?.(item) ?? false}
              onSelect={() => props.onSelect(item)}
            >
              {props.renderItem?.(item) ?? props.itemLabel(item)}
            </ComboboxOption>
          ))}
        </CommandList>
        {props.footer}
      </Command>
    </PopoverContent>
  )
}

/** `aria-selected` belongs to cmdk's keyboard highlight, so the chosen state
 * is exposed separately through `aria-checked` and the check icon. */
function ComboboxOption(props: {
  value: string
  selected: boolean
  disabled: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <CommandItem
      value={props.value}
      disabled={props.disabled}
      onSelect={props.onSelect}
      data-checked={props.selected}
      aria-checked={props.selected}
      className="pr-8 [&>svg:last-child]:absolute [&>svg:last-child]:right-2"
    >
      {props.children}
    </CommandItem>
  )
}

export { Combobox }
