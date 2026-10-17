import { and, eq } from 'drizzle-orm';
import {
  examPlanTable,
  examStudentAssessmentTable,
  examAssessmentSettingsTable,
  examLifecycleTable,
} from '@campuspilot/db/schema/exam';
import type { ExamScope } from './exam.service';

/** Keep each persisted exam resource scoped by school, session and exam identity. */
export const examWhere = (scope: ExamScope) =>
  and(
    eq(examPlanTable.schoolId, scope.schoolId),
    eq(examPlanTable.sessionId, scope.sessionId),
    eq(examPlanTable.examSlug, scope.examSlug),
  );
export const assessmentWhere = (scope: ExamScope) =>
  and(
    eq(examStudentAssessmentTable.schoolId, scope.schoolId),
    eq(examStudentAssessmentTable.sessionId, scope.sessionId),
    eq(examStudentAssessmentTable.examSlug, scope.examSlug),
  );
export const settingsWhere = (scope: ExamScope) =>
  and(
    eq(examAssessmentSettingsTable.schoolId, scope.schoolId),
    eq(examAssessmentSettingsTable.sessionId, scope.sessionId),
    eq(examAssessmentSettingsTable.examSlug, scope.examSlug),
  );
export const lifecycleWhere = (scope: ExamScope) =>
  and(
    eq(examLifecycleTable.schoolId, scope.schoolId),
    eq(examLifecycleTable.sessionId, scope.sessionId),
    eq(examLifecycleTable.examSlug, scope.examSlug),
  );
