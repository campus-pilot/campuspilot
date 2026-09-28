import type { DatabaseExecutor } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { and, eq } from 'drizzle-orm';

import { rpcError } from '../../../errors';

/**
 * Enforces the one-way registration boundary shared by admission and student
 * mutations. Reads remain available so historical records can still be shown.
 */
export async function assertAdmissionRegistered(
  db: DatabaseExecutor,
  input: { schoolId: string; admissionId: string },
) {
  const [admission] = await db
    .select({ id: admissionTable.id, registered: admissionTable.registered })
    .from(admissionTable)
    .where(
      and(
        eq(admissionTable.schoolId, input.schoolId),
        eq(admissionTable.id, input.admissionId),
      ),
    )
    .limit(1)
    .for('update');
  if (!admission) throw rpcError.notFound('Admission');
  if (!admission.registered) {
    throw rpcError.badRequest(
      'This admission is no longer registered with the school and cannot be changed.',
    );
  }
}
