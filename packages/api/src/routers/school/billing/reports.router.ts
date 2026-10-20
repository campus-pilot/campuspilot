import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";

import { toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import { classFinanceSnapshotInputSchema, classFinanceSnapshotOutputSchema, collectionRegisterInputSchema, collectionRegisterOutputSchema, feeElementReportInputSchema, feeElementReportOutputSchema, sessionFinanceOverviewInputSchema, sessionFinanceOverviewOutputSchema } from "./reports.dto";
import { getClassFinanceSnapshot, getCollectionRegister, getFeeElementReport, getSessionFinanceOverview } from "./reports-read";

const reportHandler = <TInput, TOutput>(callback: (input: TInput) => Promise<TOutput>) => async ({ input }: { input: TInput }) => {
  try { return await callback(input); }
  catch (error) { throw toRpcError(error); }
};

const route = (summary: string, description: string) => ({
  summary,
  description,
  tags: ["School", "Billing", "Reports"],
});

export const financeReportsRouter = {
  getSessionFinanceOverview: protectedProcedure.route(route(
    "Read session finance overview",
    "Read aggregate billed, collected, refunded, adjusted, outstanding, credit, and collection-rate totals for one explicit academic session.",
  )).input(sessionFinanceOverviewInputSchema).use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_REPORTS)).output(sessionFinanceOverviewOutputSchema).handler(({ context, input }) => reportHandler((value: typeof input) => getSessionFinanceOverview(context.db, value))({ input })),
  getCollectionRegister: protectedProcedure.route(route(
    "Read collection register",
    "List payment and refund transactions for one explicit academic session with stable pagination and optional recorded-date filtering.",
  )).input(collectionRegisterInputSchema).use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_REPORTS)).output(collectionRegisterOutputSchema).handler(({ context, input }) => reportHandler((value: typeof input) => getCollectionRegister(context.db, value))({ input })),
  getFeeElementFinanceReport: protectedProcedure.route(route(
    "Read fee-element finance report",
    "Summarize billed amounts and bill-level adjustments by immutable fee-element snapshot for one explicit academic session.",
  )).input(feeElementReportInputSchema).use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_REPORTS)).output(feeElementReportOutputSchema).handler(({ context, input }) => reportHandler((value: typeof input) => getFeeElementReport(context.db, value))({ input })),
  getClassFinanceSnapshot: protectedProcedure.route(route(
    "Read class finance snapshot",
    "Summarize bills, allocations, adjustments, and outstanding balances by snapshotted class placement for one explicit academic session.",
  )).input(classFinanceSnapshotInputSchema).use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_REPORTS)).output(classFinanceSnapshotOutputSchema).handler(({ context, input }) => reportHandler((value: typeof input) => getClassFinanceSnapshot(context.db, value))({ input })),
};
