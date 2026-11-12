import { createHash } from 'node:crypto';

import { rpcError } from '@campuspilot/api/errors';
import { makeImageDerivatives } from '@campuspilot/api/files/image-derivative';
import {
  deleteObjectsBestEffort,
  getObjectBytes,
  putObject,
} from '@campuspilot/api/routers/school/question-paper/question-paper.storage';
import {
  ASSISTANT_ATTACHMENTS_PER_MESSAGE,
  ASSISTANT_UNSENT_ATTACHMENTS_PER_USER,
  ASSISTANT_UNSENT_ATTACHMENT_TTL_HOURS,
  type AssistantAttachmentRef,
} from '@campuspilot/assistant-contract/attachments';
import { assistantAttachmentTable } from '@campuspilot/db/schema/assistant';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import type { AssistantDatabase, AssistantExecutor } from './db';
import { db as defaultDb } from './db';
import { generateId } from '@campuspilot/db/id';
import { log } from './log';
import type { AttachmentFile } from './runtime/providers/types';

/**
 * Chat image attachments: storing them, binding them to a message, loading
 * them for a model request and sweeping the ones never sent (design G1/G2).
 * Lives outside `src/runtime` on purpose: the turn loop gets attachments
 * through an injected loader and imports no object storage or school table.
 *
 * The object storage helpers are the question paper ones (`putObject` and
 * friends are generic; only their key layout is the paper's). Attachment
 * objects live under `schools/{schoolId}/assistant/attachments/{id}/`, the
 * prefix the demo purge sweeps.
 */

export type AttachmentRow = typeof assistantAttachmentTable.$inferSelect;

const attachmentKeys = {
  original: (schoolId: string, id: string, extension: string) =>
    `schools/${schoolId}/assistant/attachments/${id}/original.${extension}`,
  thumb: (schoolId: string, id: string) => `schools/${schoolId}/assistant/attachments/${id}/thumb.jpg`,
  model: (schoolId: string, id: string) => `schools/${schoolId}/assistant/attachments/${id}/model.jpg`,
} as const;

/** The objects of an attachment row, for deleting. */
export const attachmentObjectKeys = (row: Pick<AttachmentRow, 's3Key' | 'thumbS3Key' | 'modelS3Key'>) => [
  row.s3Key,
  row.thumbS3Key,
  row.modelS3Key,
];

/** A file name for display: no path, control characters or markup-ish characters, bounded. */
export function sanitizeAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>"|?*]/g, '_').trim().slice(0, 120);
  return cleaned || 'image';
}

export function toAttachmentRef(row: AttachmentRow): AssistantAttachmentRef {
  return {
    id: row.id,
    fileName: row.originalName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    previewable: row.derivativeStatus === 'ready',
  };
}

/**
 * Stores one uploaded image as an unsent attachment: derivatives first (a
 * JPEG/PNG/WebP that cannot be decoded is a 415), then the objects, then the
 * row. The cap of unsent attachments per user and school is counted under an
 * advisory lock for that pair, so parallel uploads cannot pass it together.
 */
export async function createAttachment(
  database: AssistantDatabase,
  input: {
    schoolId: string;
    userId: string;
    file: { bytes: Buffer; contentType: string; extension: string; name: string };
  },
): Promise<AssistantAttachmentRef> {
  const { schoolId, userId, file } = input;
  const derivatives = await makeImageDerivatives(file.bytes, file.contentType);
  const id = generateId('assistantAttachment');
  const written: string[] = [];
  try {
    return await database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`assistant-attachments:${schoolId}:${userId}`}, 0))`);
      const [unsent] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(assistantAttachmentTable)
        .where(
          and(
            eq(assistantAttachmentTable.schoolId, schoolId),
            eq(assistantAttachmentTable.userId, userId),
            isNull(assistantAttachmentTable.itemId),
          ),
        );
      if (unsent!.count >= ASSISTANT_UNSENT_ATTACHMENTS_PER_USER) {
        throw rpcError.badRequest(
          `You have ${ASSISTANT_UNSENT_ATTACHMENTS_PER_USER} images waiting to be sent. Send or remove some first.`,
        );
      }
      const originalKey = attachmentKeys.original(schoolId, id, file.extension);
      written.push(originalKey);
      await putObject(originalKey, file.bytes, file.contentType);
      let thumbKey: string | null = null;
      let modelKey: string | null = null;
      if (derivatives.status === 'ready') {
        thumbKey = attachmentKeys.thumb(schoolId, id);
        modelKey = attachmentKeys.model(schoolId, id);
        written.push(thumbKey, modelKey);
        await putObject(thumbKey, derivatives.thumb.bytes, derivatives.thumb.contentType);
        await putObject(modelKey, derivatives.model.bytes, derivatives.model.contentType);
      }
      const [row] = await tx
        .insert(assistantAttachmentTable)
        .values({
          id,
          schoolId,
          userId,
          originalName: sanitizeAttachmentName(file.name),
          contentType: file.contentType,
          byteSize: file.bytes.byteLength,
          sha256: createHash('sha256').update(file.bytes).digest('hex'),
          width: derivatives.width,
          height: derivatives.height,
          s3Key: originalKey,
          derivativeStatus: derivatives.status === 'ready' ? 'ready' : 'unsupported',
          thumbS3Key: thumbKey,
          modelS3Key: modelKey,
          modelContentType: derivatives.status === 'ready' ? derivatives.model.contentType : null,
          modelByteSize: derivatives.status === 'ready' ? derivatives.model.bytes.byteLength : null,
        })
        .returning();
      return toAttachmentRef(row!);
    });
  } catch (error) {
    await deleteObjectsBestEffort(written);
    throw error;
  }
}

/**
 * Locks and returns the unsent attachments a message names, in the order the
 * message gives them. Every id must exist, belong to this school and user and
 * not be sent yet; anything else refuses the whole message (BAD_REQUEST), so
 * a message never silently loses an image. Row locks make two messages
 * naming the same attachment take turns, and the second finds it sent.
 */
export async function lockUnsentAttachments(
  tx: AssistantExecutor,
  input: { schoolId: string; userId: string; ids: readonly string[] },
): Promise<AttachmentRow[]> {
  if (input.ids.length === 0) return [];
  if (input.ids.length > ASSISTANT_ATTACHMENTS_PER_MESSAGE) {
    throw rpcError.badRequest(`A message can carry at most ${ASSISTANT_ATTACHMENTS_PER_MESSAGE} images.`);
  }
  const rows = await tx
    .select()
    .from(assistantAttachmentTable)
    .where(
      and(
        inArray(assistantAttachmentTable.id, [...input.ids]),
        eq(assistantAttachmentTable.schoolId, input.schoolId),
        eq(assistantAttachmentTable.userId, input.userId),
        isNull(assistantAttachmentTable.itemId),
      ),
    )
    .for('update');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = input.ids.map((id) => byId.get(id));
  if (ordered.some((row) => !row)) {
    throw rpcError.badRequest('One of the attached images is no longer available. Attach it again.');
  }
  return ordered as AttachmentRow[];
}

/** Binds locked attachments to the message item that carries them, keeping their order. */
export async function bindAttachments(
  tx: AssistantExecutor,
  input: { rows: readonly AttachmentRow[]; conversationId: string; itemId: string },
): Promise<void> {
  const attachedAt = new Date();
  for (const [index, row] of input.rows.entries()) {
    await tx
      .update(assistantAttachmentTable)
      .set({ conversationId: input.conversationId, itemId: input.itemId, position: index + 1, attachedAt })
      .where(and(eq(assistantAttachmentTable.id, row.id), isNull(assistantAttachmentTable.itemId)));
  }
}

/**
 * The first attachment the provider cannot read, as the message to show
 * (decision D46: said before any cost, never dropped silently). An image the
 * server decoded is sent as a JPEG copy, which every provider reads; only an
 * undecodable original (HEIC) depends on the provider.
 */
export function unreadableAttachmentMessage(
  rows: ReadonlyArray<Pick<AttachmentRow, 'originalName' | 'contentType' | 'derivativeStatus'>>,
  readableMimeTypes: readonly string[],
): string | null {
  const row = rows.find((candidate) => candidate.derivativeStatus === 'unsupported' && !readableMimeTypes.includes(candidate.contentType));
  return row ? `${row.originalName} can't be read by the assistant. Convert it to JPEG and attach it again.` : null;
}

/** The newest bytes kept in memory: the tool loop sends the history again on every step. */
const CACHE_MAX_BYTES = 64 * 1024 * 1024;

/** Least recently used, bounded by bytes. */
class ByteCache {
  private readonly entries = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  private size = 0;
  constructor(private readonly maxBytes: number) {}

  get(key: string) {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: string, value: { bytes: Uint8Array; mimeType: string }) {
    if (value.bytes.byteLength > this.maxBytes) return;
    const existing = this.entries.get(key);
    if (existing) this.size -= existing.bytes.byteLength;
    this.entries.delete(key);
    this.entries.set(key, value);
    this.size += value.bytes.byteLength;
    for (const [oldest, entry] of this.entries) {
      if (this.size <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.size -= entry.bytes.byteLength;
    }
  }
}

const cache = new ByteCache(CACHE_MAX_BYTES);

/**
 * The bytes of an attachment as a model request carries them (design G2):
 * the JPEG model copy when it exists, else the original when the provider
 * reads its type, else `unreadable`. A row or object that is gone is
 * `missing`; either way the model is told, never left to guess.
 */
export async function loadAttachmentFile(
  attachmentId: string,
  readableMimeTypes: readonly string[],
  database: AssistantDatabase = defaultDb,
): Promise<AttachmentFile> {
  const [row] = await database.select().from(assistantAttachmentTable).where(eq(assistantAttachmentTable.id, attachmentId)).limit(1);
  if (!row) return { kind: 'missing' };
  const source =
    row.derivativeStatus === 'ready' && row.modelS3Key && row.modelContentType
      ? { key: row.modelS3Key, mimeType: row.modelContentType }
      : readableMimeTypes.includes(row.contentType)
        ? { key: row.s3Key, mimeType: row.contentType }
        : null;
  if (!source) return { kind: 'unreadable' };
  const cached = cache.get(source.key);
  if (cached) return { kind: 'image', ...cached };
  try {
    const bytes = await getObjectBytes(source.key);
    cache.set(source.key, { bytes, mimeType: source.mimeType });
    return { kind: 'image', bytes, mimeType: source.mimeType };
  } catch (err) {
    log.warn({ err, attachmentId }, 'assistant.attachment.load.failed');
    return { kind: 'missing' };
  }
}

/** Rows deleted per sweep; the next sweep continues with the rest. */
const SWEEP_LIMIT = 50;

/**
 * Deletes attachments that were uploaded but never sent, once they are older
 * than {@link ASSISTANT_UNSENT_ATTACHMENT_TTL_HOURS}: the rows, then their
 * objects (best effort; the demo purge sweeps the school prefix). A row that
 * got sent meanwhile is not deleted: the delete re-checks it is still unsent.
 */
export async function sweepUnsentAttachments(database: AssistantDatabase = defaultDb, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - ASSISTANT_UNSENT_ATTACHMENT_TTL_HOURS * 3_600_000);
  const stale = await database
    .select({ id: assistantAttachmentTable.id })
    .from(assistantAttachmentTable)
    .where(and(isNull(assistantAttachmentTable.itemId), lt(assistantAttachmentTable.createdAt, cutoff)))
    .orderBy(asc(assistantAttachmentTable.createdAt))
    .limit(SWEEP_LIMIT);
  if (stale.length === 0) return { deleted: 0 };
  const deleted = await database
    .delete(assistantAttachmentTable)
    .where(and(inArray(assistantAttachmentTable.id, stale.map((row) => row.id)), isNull(assistantAttachmentTable.itemId)))
    .returning();
  await deleteObjectsBestEffort(deleted.flatMap(attachmentObjectKeys));
  return { deleted: deleted.length };
}

/** Deletes the attachments of a conversation the user deleted: the rows, then their objects (best effort). */
export async function deleteConversationAttachments(database: AssistantDatabase, conversationId: string) {
  const deleted = await database
    .delete(assistantAttachmentTable)
    .where(eq(assistantAttachmentTable.conversationId, conversationId))
    .returning();
  await deleteObjectsBestEffort(deleted.flatMap(attachmentObjectKeys));
  return { deleted: deleted.length };
}
