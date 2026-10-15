import { schoolExamDefinitionRouter } from "./exam-definition.router";
import { schoolExamPlanRouter } from "./exam-plan.router";
import { schoolExamResultRouter } from "./exam-result.router";
import { schoolExamTimetableRouter } from "./exam-timetable.router";

export const schoolExamRouter = {
  ...schoolExamDefinitionRouter,
  ...schoolExamPlanRouter,
  ...schoolExamResultRouter,
  ...schoolExamTimetableRouter,
};
