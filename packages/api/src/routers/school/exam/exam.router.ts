import { schoolExamStudentRouter } from './exam-student.router';
import { schoolExamCadetRouter } from './exam-cadet.router';
import { schoolExamDefinitionRouter } from "./exam-definition.router";
import { schoolExamPlanRouter } from "./exam-plan.router";
import { schoolExamResultRouter } from "./exam-result.router";
import { schoolExamTimetableRouter } from "./exam-timetable.router";
import { schoolExamResultNotificationRouter } from "./exam-result-notification.router";
import { schoolQuestionPaperRouter } from "../question-paper/question-paper.router";
import { gateRouterOnSchoolFeature } from "../../../permissions/feature";

/**
 * What of an examination needs student management (docs/feature-flags.md):
 * its students, results, attendance, timetable, result notifications and
 * per-student remarks. Without it an examination keeps its definition, its
 * subject plans, its lifecycle and its question papers. Completion then does
 * not wait for results, which can no longer be entered (`transitionExam`'s
 * `reviewResults`); students and results the school had before are kept.
 *
 * The Cadet Portal release keeps its own `cadet` gate (which requires student
 * management), and withdrawing a release stays open for the reason recorded
 * on `withdrawExamFromCadet`.
 */
const { transitionExam, ...examStudentWork } = schoolExamStudentRouter;
const { getStudentExamRemark, saveStudentExamRemark, ...examCadetRelease } = schoolExamCadetRouter;

export const schoolExamRouter = {
  ...gateRouterOnSchoolFeature("studentManagement", examStudentWork),
  transitionExam,
  ...examCadetRelease,
  ...gateRouterOnSchoolFeature("studentManagement", { getStudentExamRemark, saveStudentExamRemark }),
  ...schoolExamDefinitionRouter,
  ...schoolExamPlanRouter,
  ...gateRouterOnSchoolFeature("studentManagement", schoolExamResultRouter),
  ...gateRouterOnSchoolFeature("studentManagement", schoolExamTimetableRouter),
  ...gateRouterOnSchoolFeature("studentManagement", schoolExamResultNotificationRouter),
  ...schoolQuestionPaperRouter,
};
