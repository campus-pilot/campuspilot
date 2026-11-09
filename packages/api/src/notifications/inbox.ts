import type { DatabaseExecutor } from '@campuspilot/db';
import {
  notificationTypesFor,
  type NotificationAudience,
} from '@campuspilot/db/notifications/catalogue';
import { notificationTable } from '@campuspilot/db/schema/notification';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';

/**
 * The one query module behind both inboxes (staff in management, students in
 * the Cadet Portal; D-20, D-27). Every read and write goes through
 * {@link notificationVisibleTo}; the viewer always comes from the session,
 * never from input, and there is no read by ID, so no procedure can reach
 * another recipient's row. Writes on rows outside the predicate are no-ops.
 */

/** Who is reading, as established by the session. */
export type NotificationViewer =
  | { kind: 'staff_user'; userId: string; schoolId: string }
  | { kind: 'admission'; admissionId: string; schoolId: string };

/**
 * The shared visibility predicate: the viewer's own rows of their school
 * (recipient kind, recipient ID and school are each matched explicitly), not
 * dismissed, and of a type the current catalogue knows for that audience.
 * Rows of retired or foreign-audience types are filtered here, never fatal.
 */
export function notificationVisibleTo(viewer: NotificationViewer): SQL {
  const audience: NotificationAudience = viewer.kind;
  const recipient = viewer.kind === 'staff_user'
    ? eq(notificationTable.userId, viewer.userId)
    : eq(notificationTable.admissionId, viewer.admissionId);
  return and(
    eq(notificationTable.recipientKind, viewer.kind),
    recipient,
    eq(notificationTable.schoolId, viewer.schoolId),
    isNull(notificationTable.dismissedAt),
    inArray(notificationTable.type, notificationTypesFor(audience)),
  )!;
}

/** Default and maximum page size of the inbox list. */
export const NOTIFICATION_PAGE_SIZE = 20;
export const NOTIFICATION_MAX_PAGE_SIZE = 20;
/** At most this many IDs per mark-read or dismiss call. */
export const NOTIFICATION_MAX_IDS = 50;

/** Keyset position after the last row of a page. */
export type NotificationCursor = { createdAt: string; id: string };

const CURSOR_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([a-z]+_[a-z0-9]{21})$/;

/** Opaque cursor text: `<ISO created_at>|<id>`. */
export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return `${cursor.createdAt}|${cursor.id}`;
}

export function decodeNotificationCursor(value: string): NotificationCursor | null {
  const match = CURSOR_PATTERN.exec(value);
  return match ? { createdAt: match[1]!, id: match[2]! } : null;
}

/** Which rows a page lists. */
export type NotificationListFilter = 'all' | 'unread';

export type NotificationInboxRow = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
};

/**
 * One page, newest first, ordered by (created_at, id) so rows written by one
 * fan-out (same timestamp) still page deterministically. Fetches `limit + 1`
 * to know whether another page exists without counting.
 */
export async function listNotifications(
  db: DatabaseExecutor,
  viewer: NotificationViewer,
  options: { limit: number; cursor: NotificationCursor | null; filter: NotificationListFilter },
): Promise<{ items: NotificationInboxRow[]; nextCursor: string | null }> {
  const conditions: SQL[] = [notificationVisibleTo(viewer)];
  if (options.filter === 'unread') conditions.push(isNull(notificationTable.readAt));
  if (options.cursor) {
    const after = new Date(options.cursor.createdAt);
    conditions.push(
      or(
        lt(notificationTable.createdAt, after),
        and(eq(notificationTable.createdAt, after), lt(notificationTable.id, options.cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select({
      id: notificationTable.id,
      type: notificationTable.type,
      data: notificationTable.data,
      createdAt: notificationTable.createdAt,
      readAt: notificationTable.readAt,
    })
    .from(notificationTable)
    .where(and(...conditions))
    .orderBy(desc(notificationTable.createdAt), desc(notificationTable.id))
    .limit(options.limit + 1);
  const items = rows.slice(0, options.limit);
  const last = items.at(-1);
  const nextCursor = rows.length > options.limit && last
    ? encodeNotificationCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
    : null;
  return { items, nextCursor };
}

/** Unread rows of the viewer (served by the partial unread indexes). */
export async function countUnreadNotifications(db: DatabaseExecutor, viewer: NotificationViewer): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(notificationTable)
    .where(and(notificationVisibleTo(viewer), isNull(notificationTable.readAt)));
  return row?.count ?? 0;
}

/** Marks the viewer's listed unread rows read; returns how many changed. */
export async function markNotificationsRead(db: DatabaseExecutor, viewer: NotificationViewer, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const updated = await db
    .update(notificationTable)
    .set({ readAt: new Date() })
    .where(and(notificationVisibleTo(viewer), inArray(notificationTable.id, [...ids]), isNull(notificationTable.readAt)))
    .returning({ id: notificationTable.id });
  return updated.length;
}

/**
 * Marks every unread row created before `before` read. The bound is the
 * server's clock (a client value is clamped to it), so a row that lands
 * while the user clicks is not marked read unseen.
 */
export async function markAllNotificationsRead(
  db: DatabaseExecutor,
  viewer: NotificationViewer,
  before: Date | undefined,
  now: Date = new Date(),
): Promise<number> {
  const bound = before && before < now ? before : now;
  const updated = await db
    .update(notificationTable)
    .set({ readAt: now })
    .where(and(notificationVisibleTo(viewer), isNull(notificationTable.readAt), lt(notificationTable.createdAt, bound)))
    .returning({ id: notificationTable.id });
  return updated.length;
}

/**
 * Hides the viewer's listed rows from their inbox. Only read rows can be
 * dismissed (enforced here and by a CHECK). The row is kept, not deleted, so
 * the staff delivery log of its remote copies survives; retention removes it.
 */
export async function dismissNotifications(db: DatabaseExecutor, viewer: NotificationViewer, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const updated = await db
    .update(notificationTable)
    .set({ dismissedAt: new Date() })
    .where(and(notificationVisibleTo(viewer), inArray(notificationTable.id, [...ids]), isNotNull(notificationTable.readAt)))
    .returning({ id: notificationTable.id });
  return updated.length;
}
