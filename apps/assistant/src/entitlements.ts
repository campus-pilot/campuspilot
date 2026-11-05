/**
 * School-level access and limits for the assistant. Today everything is
 * allowed; the platform's feature-flag and limits work plugs in by replacing
 * this one implementation (`configureEntitlements`). Inputs are explicit
 * facts so a policy never infers the school from anything else, and every
 * run records its token usage with its school (`assistant.assistant_run`),
 * so limits can count real usage.
 */
export type EntitlementDecision = { allowed: true } | { allowed: false; reason: string };

export type AssistantEntitlements = {
  checkRunAllowed: (input: { schoolId: string; userId: string }) => Promise<EntitlementDecision>;
};

const unlimited: AssistantEntitlements = {
  checkRunAllowed: async () => ({ allowed: true }),
};

let current: AssistantEntitlements = unlimited;

export const entitlements = (): AssistantEntitlements => current;

export function configureEntitlements(next: AssistantEntitlements | null) {
  current = next ?? unlimited;
}
