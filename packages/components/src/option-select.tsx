'use client';

import type { ComponentProps, ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@campuspilot/ui/components/select';

const EMPTY_OPTION_VALUE = '__campuspilot_option_select_empty__';

function encodeOptionValue(value: string) {
  return value === '' ? EMPTY_OPTION_VALUE : value;
}

export type OptionSelectOption<T extends string = string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

/**
 * Renders a portal-based select while preserving empty strings as domain values.
 * Radix reserves an empty item value for clearing, so it is encoded internally
 * and decoded before the owning form receives the change.
 */
export function OptionSelect<T extends string>({
  value,
  options,
  onValueChange,
  name,
  disabled = false,
  triggerProps,
}: {
  value: T;
  options: readonly OptionSelectOption<T>[];
  onValueChange: (value: T) => void;
  name?: string;
  disabled?: boolean;
  triggerProps?: Omit<ComponentProps<typeof SelectTrigger>, 'children'>;
}) {
  return (
    <Select
      value={encodeOptionValue(value)}
      name={name}
      disabled={disabled}
      onValueChange={(nextValue) =>
        onValueChange(
          (nextValue === EMPTY_OPTION_VALUE ? '' : nextValue) as T,
        )
      }
    >
      <SelectTrigger {...triggerProps}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((option) => (
          <SelectItem
            key={encodeOptionValue(option.value)}
            value={encodeOptionValue(option.value)}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
