import { z } from "zod";
import {
  roleEnum,
  roleMetaSchema,
} from "@campuspilot/db/schema/jsonb/role";

export { roleEnum };
export type { Role } from "@campuspilot/db/schema/jsonb/role";

export const schoolRoleAssignmentSchema = z
  .object({
    role: roleEnum,
    meta: roleMetaSchema.nullable().default(null),
  })
  .refine(
    ({ role, meta }) => role === "teacher" || meta?.classIds == null,
    {
      message: "Class assignments can only be attached to the teacher role.",
      path: ["meta", "classIds"],
    },
  );

const schoolRoleAssignmentsSchema = z
  .array(schoolRoleAssignmentSchema)
  .min(1)
  .max(5)
  .refine(
    (assignments) =>
      new Set(assignments.map(({ role }) => role)).size === assignments.length,
    { message: "Each role can only be assigned once." },
  );

export const inviteSchoolMemberInputSchema = z.object({
  schoolId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  email: z.email().transform((email) => email.toLowerCase()),
  roles: schoolRoleAssignmentsSchema,
});

export const schoolMemberDtoSchema = z.object({
  schoolId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.email(),
  roles: z.array(schoolRoleAssignmentSchema),
});

export type SchoolMemberDto = z.infer<typeof schoolMemberDtoSchema>;
