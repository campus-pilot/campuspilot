import type { NotificationListItem } from './notification-renderers';

/**
 * Pure helpers the app containers use to patch their TanStack Query caches
 * optimistically (D-28). They only transform data; the containers own the
 * queries and mutations. Rows marked read stay in place (also under the
 * Unread filter) until the next refetch, so a row never vanishes under the
 * reader's pointer or shifts the keyset cursor.
 */

export type NotificationPage<TItem extends NotificationListItem = NotificationListItem> = {
  items: TItem[];
  nextCursor: string | null;
};

/** The shape of a TanStack infinite query's data. */
export type NotificationPages<TItem extends NotificationListItem = NotificationListItem> = {
  pages: NotificationPage<TItem>[];
  pageParams: unknown[];
};

/** Marks the listed rows read (`'all'`: every unread row) in cached pages. */
export function markPagesRead<TItem extends NotificationListItem>(
  data: NotificationPages<TItem> | undefined,
  ids: readonly string[] | 'all',
  readAt: Date,
): NotificationPages<TItem> | undefined {
  if (!data) return data;
  const targets = ids === 'all' ? null : new Set(ids);
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.readAt === null && (targets === null || targets.has(item.id)) ? { ...item, readAt } : item,
      ),
    })),
  };
}

/** Removes dismissed rows from cached pages. */
export function removeFromPages<TItem extends NotificationListItem>(
  data: NotificationPages<TItem> | undefined,
  ids: readonly string[],
): NotificationPages<TItem> | undefined {
  if (!data) return data;
  const targets = new Set(ids);
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, items: page.items.filter((item) => !targets.has(item.id)) })),
  };
}

/** Unread rows among the listed IDs in cached pages (to lower the badge count). */
export function countUnreadInPages(data: NotificationPages | undefined, ids: readonly string[]): number {
  if (!data) return 0;
  const targets = new Set(ids);
  const seen = new Set<string>();
  for (const page of data.pages) {
    for (const item of page.items) if (item.readAt === null && targets.has(item.id)) seen.add(item.id);
  }
  return seen.size;
}
