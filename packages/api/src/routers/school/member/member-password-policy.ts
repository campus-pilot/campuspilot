import type { Role } from "@campuspilot/db/schema/jsonb/role";

import type { AuthPrincipal } from "../../../context";

/**
 * Whether a role change makes someone a principal they were not before.
 * Principals hold `school.member.password.issue`, so whoever can appoint a
 * principal can give themselves (or an account they control) the power to
 * take over staff accounts. Appointing one therefore needs that permission
 * too; otherwise a manager could promote themselves and reset the real
 * principal's password. Keeping or removing the role needs nothing extra.
 */
export function grantsPrincipalRole(
  currentRoles: readonly Role[],
  nextRoles: readonly Role[],
): boolean {
  return nextRoles.includes("principal") && !currentRoles.includes("principal");
}

/**
 * Whether a caller may be handed a newly issued staff password. Only a
 * person signed in to CampusPilot: an AI app (OAuth or an API key over MCP)
 * or the in-app assistant would put the credential into a model transcript,
 * so credentials stay a human action (see docs/staff-sign-in.md).
 */
export function mayReceiveIssuedPassword(principal: AuthPrincipal): boolean {
  return principal.authMethod === "session";
}
