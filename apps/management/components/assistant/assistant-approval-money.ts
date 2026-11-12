import type { ApprovalPath } from '@campuspilot/components/assistant';

/**
 * Where a money tool's amounts that name no currency take it from:
 * - `input`: the input's own top-level `currency`.
 * - `session`: the finance currency of the input's `sessionId`.
 * - `config-or-session`: the input's `financeConfig.currency` when it sets
 *   one (the update writes that currency), else the session's.
 */
export type AmountCurrencySource = 'input' | 'session' | 'config-or-session';

/** How the approval request reads one tool's money. */
export type ToolMoney = {
  currency: AmountCurrencySource;
  /** Fee-slug maps whose values are minor-unit amounts (see `ApprovalDisplayOptions.moneyMaps`). */
  moneyMaps?: readonly ApprovalPath[];
};

/**
 * Per tool, explicit and checked against the API's posting code. A tool
 * missing here shows amounts that name no currency, and any fee-slug map,
 * as minor units: the currency is never guessed.
 * - Payment discount, adjustment calculation: posted in the command's
 *   `currency`.
 * - Manual bill lines: posted in the session's finance currency.
 * - Billing run values: run-time fee values for the session and per class
 *   slug, priced in the session's finance currency.
 * - Admission fee values and session class overrides: maps of fee slug to
 *   minor units, governed by the session configuration's currency.
 * `school.recordRefund` is deliberately absent: a refund is in its
 * payment's currency, which the input does not carry.
 */
export const TOOL_MONEY: Readonly<Record<string, ToolMoney>> = {
  'school.recordPaymentWithDiscount': { currency: 'input' },
  'school.recordAdjustment': { currency: 'input' },
  'school.createManualBill': { currency: 'session' },
  'school.postBillingRun': {
    currency: 'session',
    moneyMaps: [['runValues', 'session'], ['runValues', 'classes', '*']],
  },
  'school.updateAdmissionFinanceValues': { currency: 'session', moneyMaps: [['values']] },
  'school.updateSessionFinance': { currency: 'config-or-session', moneyMaps: [['classOverrides', '*']] },
};

function field(record: unknown, key: string): unknown {
  return typeof record === 'object' && record !== null && !Array.isArray(record)
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/**
 * What the approval request needs to read a call's money: the currency when
 * the input itself names it, the session whose finance currency to look up
 * otherwise, and the money-map paths.
 */
export function approvalMoneyPlan(
  toolName: string,
  input: unknown,
): { inputCurrency?: string; lookupSessionId?: string; moneyMaps?: readonly ApprovalPath[] } {
  const money = TOOL_MONEY[toolName];
  if (!money) return {};
  const inputCurrency =
    money.currency === 'input'
      ? text(field(input, 'currency'))
      : money.currency === 'config-or-session'
        ? text(field(field(input, 'financeConfig'), 'currency'))
        : undefined;
  const lookupSessionId =
    money.currency !== 'input' && !inputCurrency ? text(field(input, 'sessionId')) : undefined;
  return { inputCurrency, lookupSessionId, moneyMaps: money.moneyMaps };
}
