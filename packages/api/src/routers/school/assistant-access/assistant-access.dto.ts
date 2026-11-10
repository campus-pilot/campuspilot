import { roleEnum, roles } from '@campuspilot/db/schema/jsonb/role';
import { z } from 'zod';

export const assistantAccessInputSchema = z.object({
  schoolId: z.string().min(1),
});

/**
 * One school role's assistant access, as two independent facts:
 * - `eligible`: the platform lets this school open the assistant to the role
 *   (the `assistant` feature flag's `eligibleRoles`);
 * - `enabled`: the school switched the assistant on for the role.
 * Members of the role may use it only when both hold. A role the school
 * switched on that is no longer eligible keeps `enabled: true` and grants
 * nothing ("not available on your plan").
 */
export const assistantRoleAccessSchema = z.object({
  role: roleEnum,
  eligible: z.boolean(),
  enabled: z.boolean(),
});

export const assistantAccessDtoSchema = z.object({
  schoolId: z.string(),
  /** Every school role, in the platform's role order. */
  roles: z.array(assistantRoleAccessSchema),
  /** The school's monthly spend limit in USD (set by the platform); null when there is none. */
  monthlyLimitUsd: z.number().nullable(),
});

export type AssistantAccessDto = z.infer<typeof assistantAccessDtoSchema>;

export const updateAssistantRolesInputSchema = z.object({
  schoolId: z.string().min(1),
  /** The roles to switch on or off; roles not listed keep their state. */
  roles: z
    .array(z.object({ role: roleEnum, enabled: z.boolean() }))
    .min(1)
    .max(roles.length)
    .refine((changes) => new Set(changes.map((change) => change.role)).size === changes.length, 'Name each role once.'),
});

export type UpdateAssistantRolesInput = z.infer<typeof updateAssistantRolesInputSchema>;
