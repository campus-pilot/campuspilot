import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { classTable, sectionTable } from '@campuspilot/db/schema/class';
import type {
  FinanceSchemaConfig,
  FinanceValuesMap,
} from '@campuspilot/db/schema/jsonb/finance-config';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { studentTable } from '@campuspilot/db/schema/student';
import { eq } from 'drizzle-orm';

import {
  createTestAdmission,
  createTestClass,
  createTestSchool,
  createTestSession,
  createTestStudent,
} from '../fixtures';
import { createFinanceActors, type FinanceActors } from './actors';
import { createFinanceConfig } from './factories';

export type FinanceScenarioOptions = {
  activeValues?: FinanceValuesMap;
  historicalValues?: FinanceValuesMap;
  /** Override only for date-boundary tests; normal finance fixtures remain in
   * their intentionally isolated future sessions. */
  activeStartYear?: number;
};

export type FinanceScenario = {
  school: typeof schoolTable.$inferSelect;
  outsiderSchool: typeof schoolTable.$inferSelect;
  activeSession: typeof schoolSessionTable.$inferSelect;
  historicalSession: typeof schoolSessionTable.$inferSelect;
  schoolClass: typeof classTable.$inferSelect;
  section: typeof sectionTable.$inferSelect;
  admission: typeof admissionTable.$inferSelect;
  activeStudent: typeof studentTable.$inferSelect;
  historicalStudent: typeof studentTable.$inferSelect;
  actors: FinanceActors;
  financeConfig: FinanceSchemaConfig;
};

/**
 * Creates an isolated, multi-session admission account on the real integration
 * database. Monetary tests should create a fresh scenario instead of sharing
 * posted history between cases.
 */
export async function createFinanceScenario(
  options: FinanceScenarioOptions = {},
): Promise<FinanceScenario> {
  const activeStartYear = options.activeStartYear ?? 2040;
  const [school, outsiderSchool] = await Promise.all([
    createTestSchool(),
    createTestSchool(),
  ]);
  const [activeSession, historicalSession] = await Promise.all([
    createTestSession({
      schoolId: school.id,
      sessionStartYear: activeStartYear,
      sessionEndYear: activeStartYear + 1,
      isActive: true,
    }),
    createTestSession({
      schoolId: school.id,
      sessionStartYear: activeStartYear - 1,
      sessionEndYear: activeStartYear,
      isActive: false,
    }),
  ]);
  const [{ schoolClass, sections }, admission, actors] = await Promise.all([
    createTestClass({ schoolId: school.id }),
    createTestAdmission({ schoolId: school.id }),
    createFinanceActors(school.id, outsiderSchool.id),
  ]);
  const financeConfig = createFinanceConfig();
  await Promise.all([
    db
      .update(schoolSessionTable)
      .set({ financeConfig })
      .where(eq(schoolSessionTable.id, activeSession.id)),
    db
      .update(schoolSessionTable)
      .set({ financeConfig })
      .where(eq(schoolSessionTable.id, historicalSession.id)),
    db
      .update(admissionTable)
      .set({
        financeValue: {
          ...(options.historicalValues
            ? { [historicalSession.id]: options.historicalValues }
            : {}),
          ...(options.activeValues
            ? { [activeSession.id]: options.activeValues }
            : {}),
        },
      })
      .where(eq(admissionTable.id, admission.id)),
  ]);
  const [activeStudent, historicalStudent] = await Promise.all([
    createTestStudent({
      schoolId: school.id,
      admissionId: admission.id,
      sessionId: activeSession.id,
      classId: schoolClass.id,
      sectionId: sections[0]!.id,
      rollNo: 1,
    }),
    createTestStudent({
      schoolId: school.id,
      admissionId: admission.id,
      sessionId: historicalSession.id,
      classId: schoolClass.id,
      sectionId: sections[0]!.id,
      rollNo: 1,
    }),
  ]);

  return {
    school,
    outsiderSchool,
    activeSession,
    historicalSession,
    schoolClass,
    section: sections[0]!,
    admission,
    activeStudent,
    historicalStudent,
    actors,
    financeConfig,
  };
}
