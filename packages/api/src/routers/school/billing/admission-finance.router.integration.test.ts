import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createFinanceScenario,
  expectNoFinanceValue,
  expectRpcCode,
} from '../../../../test/finance';
import {
  createTestAdmission,
  createTestSession,
} from '../../../../test/fixtures';

function generalAdmissionInput(schoolId: string, admissionNo: string) {
  return {
    schoolId,
    name: `Student ${admissionNo}`,
    admissionNo,
    address: 'Test address',
    phoneNo: '9999999999',
    email: null,
    dob: '2015-01-01',
    fatherName: 'Test Father',
    motherName: 'Test Mother',
  };
}

describe('admission finance router integration', () => {
  it('allows finance roles and platform admin while denying other callers', async () => {
    const scenario = await createFinanceScenario();
    const input = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
    };

    for (const [index, actor] of [
      scenario.actors.principal,
      scenario.actors.manager,
      scenario.actors.accountant,
      scenario.actors.platformAdmin,
    ].entries()) {
      const values = { transport: 500 + index };
      await expect(
        actor.client.school.updateAdmissionFinanceValues({ ...input, values }),
      ).resolves.toMatchObject({ ...input, values });
      await expect(
        actor.client.school.getAdmissionFinanceValues(input),
      ).resolves.toMatchObject({ ...input, values });
    }

    for (const actor of [
      scenario.actors.teacher,
      scenario.actors.examCoordinator,
      scenario.actors.regularUser,
    ]) {
      await expectRpcCode(
        actor.client.school.getAdmissionFinanceValues(input),
        'FORBIDDEN',
      );
      await expectRpcCode(
        actor.client.school.updateAdmissionFinanceValues({
          ...input,
          values: { transport: 600 },
        }),
        'FORBIDDEN',
      );
    }
    await expectRpcCode(
      scenario.actors.outsiderManager.client.school.getAdmissionFinanceValues(
        input,
      ),
      'FORBIDDEN',
    );
    await expectRpcCode(
      scenario.actors.anonymous.client.school.getAdmissionFinanceValues(input),
      'UNAUTHORIZED',
    );
  });

  it('requires matching tenant entities, an active session, and admission scope', async () => {
    const scenario = await createFinanceScenario({
      historicalValues: { transport: 250 },
    });
    const client = scenario.actors.accountant.client;
    const base = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
    };
    const outsiderAdmission = await createTestAdmission({
      schoolId: scenario.outsiderSchool.id,
    });
    const outsiderSession = await createTestSession({
      schoolId: scenario.outsiderSchool.id,
      sessionStartYear: 2040,
      sessionEndYear: 2041,
      isActive: true,
    });

    await expectRpcCode(
      client.school.getAdmissionFinanceValues({
        ...base,
        admissionId: outsiderAdmission.id,
        sessionId: scenario.activeSession.id,
      }),
      'NOT_FOUND',
    );
    await expectRpcCode(
      client.school.getAdmissionFinanceValues({
        ...base,
        sessionId: outsiderSession.id,
      }),
      'NOT_FOUND',
    );
    await expectRpcCode(
      client.school.updateAdmissionFinanceValues({
        ...base,
        sessionId: scenario.historicalSession.id,
        values: { transport: 300 },
      }),
      'CONFLICT',
    );
    await expectRpcCode(
      client.school.updateAdmissionFinanceValues({
        ...base,
        sessionId: scenario.activeSession.id,
        values: { tuition: 1000 },
      }),
      'BAD_REQUEST',
    );
    await expectRpcCode(
      client.school.updateAdmissionFinanceValues({
        ...base,
        sessionId: scenario.activeSession.id,
        values: { unknown: 1000 },
      }),
      'BAD_REQUEST',
    );
    await expect(
      client.school.getAdmissionFinanceValues(base as never),
    ).rejects.toThrow();
  });

  it('updates or removes one session while preserving every other session', async () => {
    const scenario = await createFinanceScenario({
      activeValues: { transport: 300 },
      historicalValues: { transport: 250 },
    });
    const client = scenario.actors.manager.client;
    const input = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
    };

    await expect(
      client.school.updateAdmissionFinanceValues({
        ...input,
        values: { transport: 725 },
      }),
    ).resolves.toMatchObject({ values: { transport: 725 } });
    let [stored] = await db
      .select({ financeValue: admissionTable.financeValue })
      .from(admissionTable)
      .where(eq(admissionTable.id, scenario.admission.id));
    expect(stored?.financeValue).toEqual({
      [scenario.activeSession.id]: { transport: 725 },
      [scenario.historicalSession.id]: { transport: 250 },
    });

    await expect(
      client.school.updateAdmissionFinanceValues({ ...input, values: {} }),
    ).resolves.toMatchObject({ values: {} });
    [stored] = await db
      .select({ financeValue: admissionTable.financeValue })
      .from(admissionTable)
      .where(eq(admissionTable.id, scenario.admission.id));
    expect(stored?.financeValue).toEqual({
      [scenario.historicalSession.id]: { transport: 250 },
    });
  });

  it('allows reads but rejects pricing mutations after unregistration', async () => {
    const scenario = await createFinanceScenario({
      activeValues: { transport: 300 },
    });
    const client = scenario.actors.manager.client;
    const input = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
    };

    await client.school.unregisterAdmission({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      confirmationName: scenario.admission.name,
    });
    await expect(
      client.school.getAdmissionFinanceValues(input),
    ).resolves.toMatchObject({ values: { transport: 300 } });
    await expectRpcCode(
      client.school.updateAdmissionFinanceValues({
        ...input,
        values: { transport: 999 },
      }),
      'BAD_REQUEST',
    );

    const [stored] = await db
      .select({
        financeValue: admissionTable.financeValue,
        registered: admissionTable.registered,
      })
      .from(admissionTable)
      .where(eq(admissionTable.id, scenario.admission.id));
    expect(stored).toMatchObject({
      registered: false,
      financeValue: {
        [scenario.activeSession.id]: { transport: 300 },
      },
    });
  });

  it('does not accept or expose pricing through general admission routes', async () => {
    const scenario = await createFinanceScenario({
      activeValues: { transport: 300 },
    });
    const manager = scenario.actors.manager.client;
    const teacher = scenario.actors.teacher.client;
    const unsafeCreateInput = {
      ...generalAdmissionInput(scenario.school.id, 'NO-LEAK-CREATE'),
      financeValue: {
        [scenario.activeSession.id]: { transport: 999 },
      },
    };
    await expectRpcCode(
      manager.school.createAdmission(unsafeCreateInput as never),
      'BAD_REQUEST',
    );
    const created = await manager.school.createAdmission(
      generalAdmissionInput(scenario.school.id, 'NO-LEAK-CREATE'),
    );
    expectNoFinanceValue(created);

    const [createdRow] = await db
      .select({ financeValue: admissionTable.financeValue })
      .from(admissionTable)
      .where(eq(admissionTable.id, created.id));
    expect(createdRow?.financeValue).toEqual({});

    const unsafeUpdateInput = {
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      address: 'Metadata only',
      financeValue: {
        [scenario.activeSession.id]: { transport: 999 },
      },
    };
    await expectRpcCode(
      manager.school.updateAdmission(unsafeUpdateInput as never),
      'BAD_REQUEST',
    );
    const [fetched, listed, student, students] = await Promise.all([
      teacher.school.getAdmission({
        schoolId: scenario.school.id,
        admissionId: scenario.admission.id,
      }),
      teacher.school.listAdmissions({ schoolId: scenario.school.id }),
      teacher.school.getStudent({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
        studentId: scenario.activeStudent.id,
      }),
      teacher.school.listStudents({
        schoolId: scenario.school.id,
        sessionId: scenario.activeSession.id,
      }),
    ]);
    expectNoFinanceValue(fetched);
    for (const admission of listed.items) expectNoFinanceValue(admission);
    expectNoFinanceValue(student);
    for (const enrollment of students.items) expectNoFinanceValue(enrollment);

    const finance = await manager.school.getAdmissionFinanceValues({
      schoolId: scenario.school.id,
      admissionId: scenario.admission.id,
      sessionId: scenario.activeSession.id,
    });
    expect(finance.values).toEqual({ transport: 300 });
  });
});
