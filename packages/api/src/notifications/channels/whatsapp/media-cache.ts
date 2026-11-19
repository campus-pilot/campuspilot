import type { DatabaseExecutor } from '@campuspilot/db';
import { whatsappMediaUploadTable } from '@campuspilot/db/schema/whatsapp-media';
import { and, eq, gt } from 'drizzle-orm';

/**
 * Reuse of WhatsApp media uploads for PDFs that are the same for every
 * recipient (`NotificationDocument.shareKey`: a notice, a timetable
 * publication). The first send uploads the PDF and records Meta's media ID
 * per (sending phone number, share key); later sends of the same document
 * reuse it instead of uploading the bytes again.
 *
 * Meta keeps uploaded media for 30 days. A recorded ID is reused only while
 * it is younger than {@link WHATSAPP_MEDIA_REUSE_MS} (25 days), so a message
 * sent near the end of the window still has five days for Meta to deliver
 * the document; an older row is ignored and replaced by the next upload.
 * Two concurrent first sends may both upload; the later upsert wins, and
 * both media IDs are valid.
 */

/** How long a recorded media ID is reused: well inside Meta's 30-day retention. */
export const WHATSAPP_MEDIA_REUSE_MS = 25 * 24 * 60 * 60 * 1000;

type MediaKey = { phoneNumberId: string; shareKey: string };

/** The recorded media ID of a shared document, or null when none is younger than the reuse window. */
export async function findReusableWhatsAppMedia(db: DatabaseExecutor, key: MediaKey, now: Date = new Date()): Promise<string | null> {
  const [row] = await db
    .select({ mediaId: whatsappMediaUploadTable.mediaId })
    .from(whatsappMediaUploadTable)
    .where(
      and(
        eq(whatsappMediaUploadTable.phoneNumberId, key.phoneNumberId),
        eq(whatsappMediaUploadTable.shareKey, key.shareKey),
        gt(whatsappMediaUploadTable.uploadedAt, new Date(now.getTime() - WHATSAPP_MEDIA_REUSE_MS)),
      ),
    )
    .limit(1);
  return row?.mediaId ?? null;
}

/** Records a fresh upload of a shared document, replacing any older one. */
export async function recordWhatsAppMediaUpload(
  db: DatabaseExecutor,
  upload: MediaKey & { schoolId: string; mediaId: string },
  uploadedAt: Date = new Date(),
): Promise<void> {
  await db
    .insert(whatsappMediaUploadTable)
    .values({ ...upload, uploadedAt })
    .onConflictDoUpdate({
      target: [whatsappMediaUploadTable.phoneNumberId, whatsappMediaUploadTable.shareKey],
      set: { schoolId: upload.schoolId, mediaId: upload.mediaId, uploadedAt },
    });
}
