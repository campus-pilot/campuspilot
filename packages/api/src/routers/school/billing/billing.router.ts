import { admissionFinanceRouter } from './admission-finance.router';
import { billingOperationsRouter } from './billing-operations.router';
import { ledgerOperationsRouter } from './ledger.router';
import { financeReportsRouter } from './reports.router';

/**
 * Composes admission pricing now and future billing, ledger, payment, report,
 * and document procedures without broadening the general admission boundary.
 */
export const schoolBillingRouter = {
  ...admissionFinanceRouter,
  ...billingOperationsRouter,
  ...ledgerOperationsRouter,
  ...financeReportsRouter,
};
