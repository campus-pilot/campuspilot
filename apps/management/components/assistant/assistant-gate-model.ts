/** `pending` means the answer is not known yet: callers show nothing rather than guess. */
export type AssistantGate = 'allowed' | 'denied' | 'pending';

/**
 * Whether the user may use the AI assistant, from the two facts that decide it
 * (the same ones `AssistantAccess` renders from):
 *
 * - the school's `assistant` feature: `ready` with `enabled` true/false, still
 *   `pending`, or `unknown` (the flags could not be read and none are held);
 * - the user's role (`getStatus().allowed`), asked only once the feature is on.
 *
 * A feature that could not be read is `denied` (fail closed), unlike a
 * `pending` one. A status request that failed while nothing is held is `denied`
 * too; known answers win over a failed background refetch.
 */
export function resolveAssistantGate(
  feature: { status: 'pending' | 'unknown' | 'ready'; enabled: boolean },
  role: { isPending: boolean; allowed: boolean | undefined },
): AssistantGate {
  if (feature.status === 'pending') return 'pending';
  if (!feature.enabled) return 'denied';
  if (role.allowed !== undefined) return role.allowed ? 'allowed' : 'denied';
  return role.isPending ? 'pending' : 'denied';
}
