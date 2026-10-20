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

export const financeReportsRouter = {
  getSessionFinanceOverview: protectedProcedure.route({ summary: "Read session finance overview", tags: ["School", "Billing", "Reports"] }).input(sessionFinanceOverviewInputSchema).use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_REPORTS)).output(sessionFinanceOverviewOutputSchema).handler(({ context, input }) => reportHandler((value: typeof input) => getSessionFinanceOverview(context.db, value))({ input })),
  getCollectionRegister: protectedProcedure.route({ summary: "Read collection register", tags: ["School", "Billing", "Reports"] }).input(collectionRegisterInputSchema).use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_REPORTS)).output(collectionRegisterOutputSchema).handler(({ context, input }) => reportHandler((value: typeof input) => getCollectionRegister(context.db, value))({ input })),
  getFeeElementFinanceReport: protectedProcedure.route({ summary: "Read fee-element finance report", tags: ["School", "Billing", "Reports"] }).input(feeElementReportInputSchema).use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_REPORTS)).output(feeElementReportOutputSchema).handler(({ context, input }) => reportHandler((value: typeof input) => getFeeElementReport(context.db, value))({ input })),
  getClassFinanceSnapshot: protectedProcedure.route({ summary: "Read class finance snapshot", tags: ["School", "Billing", "Reports"] }).input(classFinanceSnapshotInputSchema).use(requireSchoolPermission(SCHOOL_ACTIONS.READ_BILLING_REPORTS)).output(classFinanceSnapshotOutputSchema).handler(({ context, input }) => reportHandler((value: typeof input) => getClassFinanceSnapshot(context.db, value))({ input })),
};
