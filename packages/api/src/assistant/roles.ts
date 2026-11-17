import type { DatabaseExecutor } from '@campuspilot/db';
import { schoolAssistantAccessRoleTable } from '@campuspilot/db/schema/assistant';
import { roleEnum, roles, type Role } from '@campuspilot/db/schema/jsonb/role';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

/**
 * The school's assistant role list (`school_assistant_access_role`): the
 * roles whose members may use the in-app assistant. It is **one** list per
 * school with two editors, the platform administrator (admin app, School ›
 * AI) and the school's principal or manager (Settings › AI assistant). Both
 * read and write it through this file, so what one saves is what the other
 * sees: there is no second list to keep in step.
 *
 * The list is independent of whether the assistant is switched on: it is
 * kept while the feature is off. Switching the assistant on for a school
 * with an empty list switches the default roles on
 * (`switchOnDefaultAssistantRoles` in the feature flag service).
 */

/** One role and whether the assistant is switched on for it. */
export const assistantRoleStateSchema = z.object({
  role: roleEnum,
  enabled: z.boolean(),
});
export type AssistantRoleState = z.infer<typeof assistantRoleStateSchema>;

/** Roles to switch on or off; roles not listed keep their state. */
export const assistantRoleChangesSchema = z
  .array(assistantRoleStateSchema)
  .min(1)
  .max(roles.length)
  .refine((changes) => new Set(changes.map((change) => change.role)).size === changes.length, 'Name each role once.');
export type AssistantRoleChanges = z.infer<typeof assistantRoleChangesSchema>;

/** The roles the assistant is switched on for in a school. */
export async function readAssistantEnabledRoles(db: DatabaseExecutor, schoolId: string): Promise<Set<Role>> {
  const rows = await db
    .select({ role: schoolAssistantAccessRoleTable.role })
    .from(schoolAssistantAccessRoleTable)
    .where(eq(schoolAssistantAccessRoleTable.schoolId, schoolId));
  return new Set(rows.map((row) => row.role));
}

/** Every school role, in the platform's role order, with whether the assistant is switched on for it. */
export async function readAssistantRoleStates(db: DatabaseExecutor, schoolId: string): Promise<AssistantRoleState[]> {
  const enabled = await readAssistantEnabledRoles(db, schoolId);
  return roles.map((role) => ({ role, enabled: enabled.has(role) }));
}

/**
 * Switches the assistant on or off for the named roles; roles not named
 * keep their state. Every role may be switched either way, by either
 * editor, and the list may end up empty (the assistant is then on for
 * nobody until a role is switched on again). The caller has checked that
 * the actor may change the list; pass a transaction to read the result in
 * the same one.
 */
export async function applyAssistantRoleChanges(
  db: DatabaseExecutor,
  input: { schoolId: string; changes: AssistantRoleChanges; updatedBy: string },
): Promise<void> {
  const on = input.changes.filter((change) => change.enabled).map((change) => change.role);
  const off = input.changes.filter((change) => !change.enabled).map((change) => change.role);
  if (on.length > 0) {
    await db
      .insert(schoolAssistantAccessRoleTable)
      .values(on.map((role) => ({ schoolId: input.schoolId, role, updatedBy: input.updatedBy, updatedAt: new Date() })))
      .onConflictDoNothing();
  }
  if (off.length > 0) {
    await db
      .delete(schoolAssistantAccessRoleTable)
      .where(and(eq(schoolAssistantAccessRoleTable.schoolId, input.schoolId), inArray(schoolAssistantAccessRoleTable.role, off)));
  }
}
