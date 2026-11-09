import type { DatabaseExecutor } from '@campuspilot/db';
import { DEFAULT_PHONE_COUNTRY, toE164PhoneNumber } from '@campuspilot/db/phone';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';

import type { DataMigration, DataMigrationSkippedItem } from '../types';

/** Calling code prefixed onto values that do not parse (D-32); all current data is Indian (D-2b). */
const BACKFILL_CALLING_CODE = '+91';

/** What the backfill writes for one admission whose WhatsApp choice was never recorded. */
export type AdmissionPhoneBackfill =
  | { kind: 'parsed'; phoneNo: string; whatsappNo: string; whatsappSameAsPhone: true }
  | { kind: 'unparseable'; phoneNo: string; whatsappNo: null; whatsappSameAsPhone: false };

/**
 * The phone backfill for one stored value (D-2b, D-32):
 * - A value that parses as a phone number, read as Indian when it has no
 *   `+` code (so `98765 43210`, `098765 43210` and `919876543210` all give
 *   `+919876543210`), is stored in E.164 and becomes the WhatsApp number,
 *   with "same as phone" recorded as true.
 * - Any other value keeps its text with `+91` prefixed (unless it already
 *   starts with `+`), gets no WhatsApp number, and is reported.
 *   `whatsappSameAsPhone` is recorded as false, not true and not left null:
 *   true would claim a WhatsApp number equal to a phone number that is not a
 *   valid number (the CHECK forbids it, and nothing could be sent to it);
 *   null means "never recorded" and would make the backfill prefix `+91`
 *   again on the next run. False states the fact: there is no WhatsApp
 *   number taken from this phone. When staff correct the phone in the
 *   admission dialog, they choose again.
 */
export function backfillAdmissionPhone(stored: string): AdmissionPhoneBackfill {
  const e164 = toE164PhoneNumber(stored, DEFAULT_PHONE_COUNTRY);
  if (e164) return { kind: 'parsed', phoneNo: e164, whatsappNo: e164, whatsappSameAsPhone: true };
  const trimmed = stored.trim();
  const phoneNo = trimmed.startsWith('+') ? trimmed : `${BACKFILL_CALLING_CODE}${trimmed}`;
  return { kind: 'unparseable', phoneNo, whatsappNo: null, whatsappSameAsPhone: false };
}

/**
 * First data migration (plan Phase 1c). Visits every admission by ID and
 * backfills those whose WhatsApp choice was never recorded
 * (`whatsapp_same_as_phone IS NULL`): every admission created or edited
 * through the API since Phase 1b has an explicit choice and is left alone.
 *
 * `whatsapp_verified` is written false (D-34; a row without a WhatsApp number
 * cannot have been verified). `whatsapp_consent` is not written: the column
 * default is false (D-34), and a consent staff recorded explicitly before
 * the backfill reached the row is kept. `updated_at` is not touched: this is
 * not an edit by a person.
 *
 * Rows are locked for the batch and every update is fenced on the choice
 * still being unrecorded, so a concurrent edit through the API wins.
 */
export const admissionPhoneE164Migration: DataMigration = {
  id: 'admission-phone-e164',
  description: 'Converts existing admission phone numbers to E.164 (+91 for Indian numbers) and records the WhatsApp number as the same as the phone number, not verified.',
  batchSize: 500,
  runBatch: async (db: DatabaseExecutor, { cursor, limit }) => {
    const rows = await db
      .select({
        id: admissionTable.id,
        schoolId: admissionTable.schoolId,
        phoneNo: admissionTable.phoneNo,
        whatsappSameAsPhone: admissionTable.whatsappSameAsPhone,
      })
      .from(admissionTable)
      .where(cursor === null ? undefined : gt(admissionTable.id, cursor))
      .orderBy(asc(admissionTable.id))
      .limit(limit)
      .for('update');
    let changed = 0;
    const skipped: DataMigrationSkippedItem[] = [];
    for (const row of rows) {
      if (row.whatsappSameAsPhone !== null) continue;
      const backfill = backfillAdmissionPhone(row.phoneNo);
      await db
        .update(admissionTable)
        .set({
          phoneNo: backfill.phoneNo,
          whatsappNo: backfill.whatsappNo,
          whatsappSameAsPhone: backfill.whatsappSameAsPhone,
          whatsappVerified: false,
        })
        .where(and(eq(admissionTable.id, row.id), isNull(admissionTable.whatsappSameAsPhone)));
      if (backfill.kind === 'parsed') {
        changed += 1;
      } else {
        skipped.push({ itemKey: row.id, reason: 'unparseable_phone', detail: { schoolId: row.schoolId, admissionId: row.id } });
      }
    }
    return {
      processed: rows.length,
      changed,
      skipped,
      nextCursor: rows.length < limit ? null : rows.at(-1)!.id,
    };
  },
};
