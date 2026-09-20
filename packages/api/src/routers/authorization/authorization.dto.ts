import type { AuthorizationRequest } from '@campuspilot/opa/authorization';
import { CLASS_ACTIONS } from '@campuspilot/opa/policies/class';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { z } from 'zod';

export { CLASS_ACTIONS, SCHOOL_ACTIONS, SYSTEM_ACTIONS };

const systemPermissionSchema = z.object({
  action: z.enum(SYSTEM_ACTIONS),
  resource: z.object({ kind: z.literal('system') }),
});

const schoolPermissionSchema = z.object({
  action: z.enum(SCHOOL_ACTIONS),
  resource: z.object({
    kind: z.literal('school'),
    schoolId: z.string().min(1),
  }),
});

const classPermissionSchema = z.object({
  action: z.enum(CLASS_ACTIONS),
  resource: z.object({
    kind: z.literal('class'),
    schoolId: z.string().min(1),
    classId: z.string().min(1),
  }),
});

/**
 * Runtime validation preserves each action's generated resource-kind contract.
 * Zod groups actions by resource kind, while the generated TypeScript contract
 * distributes them per action; the assertion bridges those equivalent shapes.
 */
export const permissionCheckSchema = z.union([
  systemPermissionSchema,
  schoolPermissionSchema,
  classPermissionSchema,
]) as z.ZodType<AuthorizationRequest>;

export type PermissionCheck = z.infer<typeof permissionCheckSchema>;

export const checkPermissionsInputSchema = z.object({
  permissions: z.array(permissionCheckSchema).min(1).max(100),
});

export const checkPermissionsOutputSchema = z.object({
  results: z.array(z.boolean()).max(100),
});
