import { z } from 'zod';

export const roles = [
  'principal',
  'manager',
  'teacher',
  'accountant',
  'exam_coordinator',
] as const;

export const roleEnum = z
  .enum(roles)
  .describe('A platform role assigned to a user within a school');

export const roleMetaSchema = z
  .object({
    classIds: z.array(z.string().min(1)).nullable(),
  })
  .describe('Optional scope metadata attached to a school role assignment');

export type Role = z.infer<typeof roleEnum>;
export type RoleMeta = z.infer<typeof roleMetaSchema>;
