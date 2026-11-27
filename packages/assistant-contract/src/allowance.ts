/**
 * How a school's AI allowance is told to its people: as the share of the
 * current spend window's allowance used, with the date it resets, never as
 * dollars (docs/school-billing.md, "The AI limit counts per period"). The API
 * words the limit refusal with these, and the management app its meter and
 * warnings, so both say the same thing.
 */

/** From this share of the allowance used (percent), the assistant panel warns that the limit is near. */
export const ASSISTANT_ALLOWANCE_WARNING_PERCENT = 80;

/** At this share the limit is reached and nobody in the school can send until the window resets. */
export const ASSISTANT_ALLOWANCE_FULL_PERCENT = 100;

/** Dates are the schools' own calendar (IST), as every other assistant date. */
const resetDateFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

/**
 * The day an allowance resets (`17 Dec`), in IST. The window's end is
 * exclusive, so this is the first day of the next window. No year: a window
 * is at most a calendar month long, so the day is always within the next one.
 */
export function formatAllowanceResetDate(resetsAt: Date): string {
  return resetDateFormatter.format(resetsAt);
}

/**
 * A share of the allowance for display. Whole percents, rounded down like the
 * figure itself, so "100%" appears exactly when the limit is reached; a share
 * that is used but below one percent reads "<1%" rather than a misleading
 * "0%". Over 100 it shows what was used (spend may pass the limit by what the
 * spend cache let through).
 */
export function formatAllowancePercent(usedPercent: number): string {
  if (usedPercent > 0 && usedPercent < 1) return '<1%';
  return `${Math.floor(usedPercent)}%`;
}

/** The limit-reached refusal: the assistant is unavailable until the window resets. */
export function allowanceReachedMessage(resetsAt: Date): string {
  return `You’ve used 100% of this period’s AI allowance. It resets on ${formatAllowanceResetDate(resetsAt)}.`;
}

/** The near-limit warning shown in the assistant panel from {@link ASSISTANT_ALLOWANCE_WARNING_PERCENT}. */
export function allowanceWarningMessage(usedPercent: number, resetsAt: Date): string {
  return `You’ve used ${formatAllowancePercent(usedPercent)} of this period’s AI allowance. It resets on ${formatAllowanceResetDate(resetsAt)}.`;
}
