import { PHONE_COUNTRY_OPTIONS, type PhoneInputValue } from "@campuspilot/components/phone-input";

/**
 * A phone number input for the marketing site: a native country select and a
 * `tel` input, styled by the page's own CSS. The site does not load the
 * Tailwind components (`@campuspilot/components/phone-input` renders those),
 * but the value and its parsing are the same, so both accept the same numbers.
 */
export function SitePhoneInput({
  id,
  value,
  invalid,
  describedBy,
  onChange,
  onBlur,
}: {
  id: string;
  value: PhoneInputValue;
  invalid: boolean;
  describedBy: string;
  onChange: (value: PhoneInputValue) => void;
  onBlur: () => void;
}) {
  return (
    <div className="pg-book-form-phone">
      <select
        aria-label="Country code"
        className="pg-book-form-input"
        value={value.country}
        onChange={(event) => onChange({ ...value, country: event.target.value as PhoneInputValue["country"] })}
      >
        {PHONE_COUNTRY_OPTIONS.map((option) => (
          // Code and calling code only: localized country names differ between
          // the prerender (Node's ICU data) and the browser, which breaks hydration.
          <option key={option.country} value={option.country}>
            {`${option.country} +${option.callingCode}`}
          </option>
        ))}
      </select>
      <input
        id={id}
        className="pg-book-form-input"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={value.number}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onBlur={onBlur}
        onChange={(event) => onChange({ ...value, number: event.target.value })}
      />
    </div>
  );
}
