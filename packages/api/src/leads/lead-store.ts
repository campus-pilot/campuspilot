import type { DatabaseExecutor } from '@campuspilot/db';
import { leadTable } from '@campuspilot/db/schema/lead';
import { and, eq } from 'drizzle-orm';

/**
 * Alert state writes of a lead. Every write is conditional on the alert
 * still being `pending`, so a replayed workflow step or a racing replica
 * never turns a sent alert back into a failed one.
 */

/** The facts the alert needs, or null when the lead's alert is no longer pending. */
export async function loadPendingLeadAlert(db: DatabaseExecutor, leadId: string) {
  const [lead] = await db
    .select({ id: leadTable.id, form: leadTable.form, response: leadTable.response })
    .from(leadTable)
    .where(and(eq(leadTable.id, leadId), eq(leadTable.alertStatus, 'pending')))
    .limit(1);
  return lead ?? null;
}

export async function markLeadAlertSent(db: DatabaseExecutor, leadId: string, messageId: string) {
  await db
    .update(leadTable)
    .set({ alertStatus: 'sent', alertSentAt: new Date(), alertMessageId: messageId, alertError: null })
    .where(and(eq(leadTable.id, leadId), eq(leadTable.alertStatus, 'pending')));
}

/** `message` must be safe to show to platform admins: no tokens, no URLs. */
export async function markLeadAlertFailed(db: DatabaseExecutor, leadId: string, message: string) {
  await db
    .update(leadTable)
    .set({ alertStatus: 'failed', alertError: message.slice(0, 500) })
    .where(and(eq(leadTable.id, leadId), eq(leadTable.alertStatus, 'pending')));
}
