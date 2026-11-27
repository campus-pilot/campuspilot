import { z } from 'zod';

import { assistantRoleChangesSchema, assistantRoleStateSchema } from '../../../assistant/roles';

export {
  allowanceUserSchema,
  schoolAssistantAllowanceSchema,
  type SchoolAssistantAllowance,
} from '../../../assistant/allowance';

// The dollar usage reads stay for the admin app (`systemAdmin.getSchoolAssistantUsage`), which imports them from here.
export {
  assistantUsageSchema,
  MAX_USAGE_RANGE_DAYS,
  type AssistantUsage,
} from '../../../assistant/usage';

export { assistantRoleStateSchema, type AssistantRoleState } from '../../../assistant/roles';

export const assistantAccessInputSchema = z.object({
  schoolId: z.string().min(1),
});

/**
 * Who may use the assistant in a school, as the settings screens show it:
 * every school role with whether the assistant is switched on for it. It is
 * the school's one role list, which the platform administrator (admin app)
 * and the school's principal or manager (Settings › AI assistant) both
 * edit; there is no separate "eligible" list.
 */
export const assistantAccessDtoSchema = z.object({
  schoolId: z.string(),
  /** Every school role, in the platform's role order. */
  roles: z.array(assistantRoleStateSchema),
  /**
   * Whether the school has an AI limit (set by the platform). Schools are
   * never told the dollar amount: they see the share of it used
   * (`school.getAssistantAllowance`).
   */
  limited: z.boolean(),
});

export type AssistantAccessDto = z.infer<typeof assistantAccessDtoSchema>;

export const updateAssistantRolesInputSchema = z.object({
  schoolId: z.string().min(1),
  /** The roles to switch on or off; roles not listed keep their state. */
  roles: assistantRoleChangesSchema,
});

export type UpdateAssistantRolesInput = z.infer<typeof updateAssistantRolesInputSchema>;

export const schoolAssistantAllowanceInputSchema = z.object({
  schoolId: z.string().min(1),
});
