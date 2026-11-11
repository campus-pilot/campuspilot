export type AssistantApprovalDecision = 'approve' | 'decline';

/** The attribute that marks the element holding one assistant chat. */
const SURFACE_ATTRIBUTE = 'data-assistant-surface';

/**
 * Spread on the element that holds one assistant chat (its container). The
 * approval shortcuts listen there, so they act only on keys pressed inside
 * that chat. `tabIndex={-1}` makes the container focusable without adding a
 * tab stop, so a click on the conversation puts focus inside the chat
 * (otherwise it would land outside it, on the page or the surrounding panel).
 */
export const ASSISTANT_SURFACE_PROPS = { [SURFACE_ATTRIBUTE]: '', tabIndex: -1 } as const;

/** Controls that use Enter themselves. */
const OWNS_ENTER =
  'input, textarea, select, button, a[href], [role=button], [role=link], summary, [contenteditable]:not([contenteditable=false]), [role=dialog], [role=menu], [role=listbox]';

/** Controls that use Escape themselves: a field being edited, or anything that closes on it. */
const OWNS_ESCAPE =
  'input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog], [role=menu], [role=listbox]';

/**
 * Which decision a key press means, if any (after T3 Code's approval keys).
 *
 * Only keys pressed inside this chat count (`surface`); a key pressed on the
 * page behind a side panel never decides anything.
 *
 * - **Enter approves** when focus is in the chat but not on a control that
 *   uses Enter (the message box, a button, a link, a menu).
 * - **Escape declines** only when focus is inside the request itself
 *   (`request`), for example on its buttons. This is the safer of the two
 *   options: elsewhere in the chat Escape keeps its usual meaning, and inside
 *   a side panel or the command palette, which close on Escape, the panel
 *   handles the key first and marks it handled, so one press never both
 *   closes the panel and declines a change.
 *
 * A control is asked about only when it sits inside the chat: a dialog that
 * contains the whole chat (the side panel, the palette) does not own the
 * chat's keys, while a menu or dialog inside the chat keeps its own. Ones
 * opened from the chat render outside it, so their keys never arrive here.
 */
export function decisionForKey(event: KeyboardEvent, surface: HTMLElement, request: HTMLElement): AssistantApprovalDecision | null {
  if (event.defaultPrevented || event.isComposing || event.repeat) return null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !surface.contains(target)) return null;
  if (event.key === 'Enter') return ownedBy(target, surface, OWNS_ENTER) ? null : 'approve';
  if (event.key === 'Escape') return request.contains(target) && !ownedBy(target, surface, OWNS_ESCAPE) ? 'decline' : null;
  return null;
}

/** Whether `target` sits on (or in) a control inside the chat that uses the key itself. */
function ownedBy(target: Element, surface: Element, selector: string): boolean {
  const owner = target.closest(selector);
  return Boolean(owner && owner !== surface && surface.contains(owner));
}

/** Marks the Approve button, so the hint knows Enter on it approves too. */
export const APPROVE_BUTTON_ATTRIBUTE = 'data-assistant-approve';

/**
 * Whether pressing Enter right now would approve the request, given where
 * focus is. The Approve button shows its Enter hint only while this holds,
 * so the hint never promises what the key will not do: with focus in the
 * message box, Enter sends the message instead.
 *
 * True when focus is inside the chat and not on a control that uses Enter
 * (the same rule `decisionForKey` applies), or on the Approve button itself,
 * where Enter presses it.
 */
function enterWouldApprove(request: HTMLElement | null): boolean {
  const focused = typeof document === 'undefined' ? null : document.activeElement;
  if (!request || !focused) return false;
  const surface = request.closest<HTMLElement>(`[${SURFACE_ATTRIBUTE}]`) ?? request;
  if (!surface.contains(focused)) return false;
  return Boolean(focused.closest(`[${APPROVE_BUTTON_ATTRIBUTE}]:enabled`)) || !ownedBy(focused, surface, OWNS_ENTER);
}

/**
 * Focus as an external store (for `useSyncExternalStore`): `subscribe`
 * reports every focus move in the document, and `enterApproves` reads the
 * answer for the request element the caller holds.
 */
export const approvalFocus = {
  subscribe(onChange: () => void) {
    document.addEventListener('focusin', onChange);
    document.addEventListener('focusout', onChange);
    return () => {
      document.removeEventListener('focusin', onChange);
      document.removeEventListener('focusout', onChange);
    };
  },
  enterApproves: enterWouldApprove,
};

/**
 * Listens for the decision keys on the chat that holds this request (the
 * nearest `ASSISTANT_SURFACE_PROPS` ancestor, or the request itself when it
 * is used on its own), never on the whole document. Attached through a ref
 * callback so it lives exactly as long as the request does. A key that
 * decides is consumed, so nothing else acts on it.
 */
export function decisionKeys(onDecide: (decision: AssistantApprovalDecision) => void, enabled: boolean) {
  return (request: HTMLElement | null) => {
    if (!request || !enabled) return;
    const surface = request.closest<HTMLElement>(`[${SURFACE_ATTRIBUTE}]`) ?? request;
    const handle = (event: KeyboardEvent) => {
      const decision = decisionForKey(event, surface, request);
      if (!decision) return;
      event.preventDefault();
      event.stopPropagation();
      onDecide(decision);
    };
    surface.addEventListener('keydown', handle);
    return () => surface.removeEventListener('keydown', handle);
  };
}
