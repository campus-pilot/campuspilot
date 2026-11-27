import {
  ASSISTANT_ALLOWANCE_FULL_PERCENT,
  formatAllowancePercent,
  formatAllowanceResetDate,
} from '@campuspilot/assistant-contract/allowance';
import { Progress } from '@campuspilot/ui/components/progress';

/**
 * How much of a school's AI allowance this period is used: the share as a
 * bar and a sentence, and the day it resets. Never an amount of money. The
 * bar stops at full; the sentence says what was used, which may pass 100%
 * by what the spend cache let through.
 */
export function AllowanceMeter({ usedPercent, resetsAt, note }: { usedPercent: number; resetsAt: Date; note?: string }) {
  const full = usedPercent >= ASSISTANT_ALLOWANCE_FULL_PERCENT;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{`${formatAllowancePercent(usedPercent)} of this period’s AI allowance used`}</p>
      <Progress value={Math.min(usedPercent, ASSISTANT_ALLOWANCE_FULL_PERCENT)} aria-label="Share of this period’s AI allowance used" />
      <p className="text-xs text-muted-foreground">
        {full
          ? `The assistant is unavailable until the allowance resets on ${formatAllowanceResetDate(resetsAt)}.`
          : `Resets on ${formatAllowanceResetDate(resetsAt)}.`}
        {note ? ` ${note}` : null}
      </p>
    </div>
  );
}
