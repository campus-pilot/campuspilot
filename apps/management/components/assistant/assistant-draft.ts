/** The part of `Storage` drafts need; tests pass a plain object. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const DRAFT_PREFIX = 'assistant:draft:';

/**
 * Where a conversation's unsent text is kept. Drafts belong to the signed-in
 * user: an office computer is shared, and the next person signing in on the
 * same tab must not see the last one's unsent text. A conversation that has
 * not started yet has no id, so a user's new conversations in a school share
 * one draft (`new`), on every surface.
 */
export function draftKey(userId: string, schoolId: string, conversationId: string | null): string {
  return `${DRAFT_PREFIX}${userId}:${schoolId}:${conversationId ?? 'new'}`;
}

/**
 * The saved draft, or an empty string. Storage can be unavailable (private
 * browsing, a blocked site, the server render); a draft is a convenience, so
 * every failure reads as "no draft" instead of an error.
 */
export function readDraft(storage: DraftStorage | null, key: string): string {
  try {
    return storage?.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/**
 * Saves the draft, or removes it when there is nothing worth keeping (empty
 * or only spaces), so a cleared box leaves no entry behind. Failures (a full
 * or unavailable store) are ignored for the same reason as in `readDraft`.
 */
export function writeDraft(storage: DraftStorage | null, key: string, text: string): void {
  try {
    if (text.trim()) storage?.setItem(key, text);
    else storage?.removeItem(key);
  } catch {
    // Nothing to do: the text is still in the box.
  }
}

/**
 * Removes every assistant draft this tab kept, whoever wrote it. Called on
 * sign-out: the keys already separate users, but unsent text should not
 * stay behind on a shared computer at all.
 */
export function forgetDrafts(storage: DraftStorage | null = sessionDraftStorage()): void {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage unavailable: there is nothing to forget.
  }
}

/**
 * The browser's session storage, or null where there is none. Drafts live
 * for the browser tab's session only: office computers are shared, so an
 * unsent message should not wait for the next person who opens the app.
 */
export function sessionDraftStorage(): DraftStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
