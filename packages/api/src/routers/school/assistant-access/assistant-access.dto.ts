import { z } from 'zod';

import { assistantRoleChangesSchema, assistantRoleStateSchema } from '../../../assistant/roles';
import { withUsageRange } from '../../../assistant/usage';

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
  /** The school's monthly spend limit in USD (set by the platform); null when there is none. */
  monthlyLimitUsd: z.number().nullable(),
});

export type AssistantAccessDto = z.infer<typeof assistantAccessDtoSchema>;

export const updateAssistantRolesInputSchema = z.object({
  schoolId: z.string().min(1),
  /** The roles to switch on or off; roles not listed keep their state. */
  roles: assistantRoleChangesSchema,
});

export type UpdateAssistantRolesInput = z.infer<typeof updateAssistantRolesInputSchema>;

/** A school's assistant spend over an inclusive range of IST calendar days. */
export const schoolAssistantUsageInputSchema = withUsageRange({ schoolId: z.string().min(1) });
