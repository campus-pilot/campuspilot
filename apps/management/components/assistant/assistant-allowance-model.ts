import {
  ASSISTANT_ALLOWANCE_FULL_PERCENT,
  ASSISTANT_ALLOWANCE_WARNING_PERCENT,
  allowanceWarningMessage,
} from '@campuspilot/assistant-contract/allowance';

/** The parts of the assistant status (`getStatus`) the allowance warning reads. */
export type AllowanceStatus = {
  available: boolean;
  allowance: { usedPercent: number; resetsAt: Date } | null;
};

/**
 * The assistant panel's near-limit warning, or null. Shown from
 * {@link ASSISTANT_ALLOWANCE_WARNING_PERCENT} until the limit while the user
 * can still send. At the limit the server refuses with its own message (the
 * 100% one, with the reset date), which closes the composer, so the warning
 * is not repeated; it is left out too while sending is unavailable for any
 * other reason, which the composer already names.
 */
export function allowanceWarningOf(status: AllowanceStatus | undefined): string | null {
  const allowance = status?.allowance;
  if (!status?.available || !allowance) return null;
  if (allowance.usedPercent < ASSISTANT_ALLOWANCE_WARNING_PERCENT || allowance.usedPercent >= ASSISTANT_ALLOWANCE_FULL_PERCENT) return null;
  return allowanceWarningMessage(allowance.usedPercent, allowance.resetsAt);
}
