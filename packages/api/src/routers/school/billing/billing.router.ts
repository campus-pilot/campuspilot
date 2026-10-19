import { admissionFinanceRouter } from './admission-finance.router';

/**
 * Composes admission pricing now and future billing, ledger, payment, report,
 * and document procedures without broadening the general admission boundary.
 */
export const schoolBillingRouter = {
  ...admissionFinanceRouter,
};
