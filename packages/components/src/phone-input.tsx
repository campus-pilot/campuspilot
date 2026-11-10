'use client';

import {
  DEFAULT_PHONE_COUNTRY,
  toE164PhoneNumber,
  type PhoneCountryCode,
} from '@campuspilot/db/phone';
import { Input } from '@campuspilot/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

/**
 * What a phone input holds while it is edited: the selected country and the
 * number as typed. It becomes E.164 only on submit
 * ({@link phoneInputValueToE164}), so typing never rewrites the field.
 */
export type PhoneInputValue = { country: PhoneCountryCode; number: string };

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

/** Every country libphonenumber knows, by display name, with its calling code. */
const COUNTRY_OPTIONS = getCountries()
  .map((country) => ({ country, name: regionNames?.of(country) ?? country, callingCode: getCountryCallingCode(country) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Editing value for a stored number. A valid E.164 value is split into its
 * country and national number. Anything else (empty, or a legacy value the
 * backfill could not parse) is shown as stored under the default country, so
 * staff see exactly what to correct.
 */
export function phoneInputValueFromStored(value: string | null | undefined): PhoneInputValue {
  if (!value) return { country: DEFAULT_PHONE_COUNTRY, number: '' };
  const parsed = value.startsWith('+') ? parsePhoneNumberFromString(value) : undefined;
  if (parsed?.isValid()) {
    return { country: parsed.country ?? DEFAULT_PHONE_COUNTRY, number: parsed.nationalNumber };
  }
  return { country: DEFAULT_PHONE_COUNTRY, number: value };
}

/** E.164 for a complete, valid entry; null otherwise. A typed `+` code wins over the selected country. */
export function phoneInputValueToE164(value: PhoneInputValue): string | null {
  return toE164PhoneNumber(value.number, value.country);
}

const COUNTRY_CODES = new Set<string>(getCountries());

/** Shape of a {@link PhoneInputValue}: a known country and the typed text. */
export const phoneInputValueSchema = z.object({
  country: z.custom<PhoneCountryCode>((value) => typeof value === 'string' && COUNTRY_CODES.has(value), 'Select a country.'),
  number: z.string(),
});

/** Zod schema for a required phone input value; the parsed output is E.164. */
export function requiredPhoneInputSchema(requiredMessage: string) {
  return phoneInputValueSchema
    .superRefine((value, context) => {
      if (!value.number.trim()) {
        context.addIssue({ code: 'custom', message: requiredMessage });
      } else if (!phoneInputValueToE164(value)) {
        context.addIssue({ code: 'custom', message: 'Enter a valid phone number for the selected country.' });
      }
    })
    .transform((value) => phoneInputValueToE164(value) ?? '');
}

/**
 * A phone number input with a country selector. Controlled: the caller (a
 * TanStack Form field) owns the {@link PhoneInputValue}.
 */
export function PhoneInput({ id, value, disabled, invalid, onChange, onBlur }: {
  id?: string;
  value: PhoneInputValue;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (value: PhoneInputValue) => void;
  onBlur?: () => void;
}) {
  return (
    <div className="flex gap-2">
      <Select
        value={value.country}
        disabled={disabled}
        onValueChange={(country) => onChange({ ...value, country: country as PhoneCountryCode })}
      >
        <SelectTrigger aria-label="Country" className="shrink-0">
          <SelectValue>{`${value.country} +${getCountryCallingCode(value.country)}`}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {COUNTRY_OPTIONS.map((option) => (
            <SelectItem key={option.country} value={option.country}>{`${option.name} (+${option.callingCode})`}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={value.number}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onBlur={onBlur}
        onChange={(event) => onChange({ ...value, number: event.target.value })}
      />
    </div>
  );
}
