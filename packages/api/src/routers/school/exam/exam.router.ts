import { schoolExamStudentRouter } from './exam-student.router';
import { schoolExamCadetRouter } from './exam-cadet.router';
import { schoolExamDefinitionRouter } from "./exam-definition.router";
import { schoolExamPlanRouter } from "./exam-plan.router";
import { schoolExamResultRouter } from "./exam-result.router";
import { schoolExamTimetableRouter } from "./exam-timetable.router";
import { schoolExamResultNotificationRouter } from "./exam-result-notification.router";
import { schoolQuestionPaperRouter } from "../question-paper/question-paper.router";

export const schoolExamRouter = {
  ...schoolExamStudentRouter,
  ...schoolExamCadetRouter,
  ...schoolExamDefinitionRouter,
  ...schoolExamPlanRouter,
  ...schoolExamResultRouter,
  ...schoolExamTimetableRouter,
  ...schoolExamResultNotificationRouter,
  ...schoolQuestionPaperRouter,
};
