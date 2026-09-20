import { z } from "zod";
import {
  roleEnum,
  roleMetaSchema,
} from "@campuspilot/db/schema/jsonb/role";

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";

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

export const schoolRoleAssignmentsSchema = z
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
  email: z.email().transform((email) => email.toLowerCase()),
  roles: schoolRoleAssignmentsSchema,
});

export const schoolMemberDtoSchema = z.object({
  schoolId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.email(),
  profileImageUrl: z.url().nullable(),
  addedAt: z.date(),
  roles: z.array(schoolRoleAssignmentSchema),
});

export type SchoolMemberDto = z.infer<typeof schoolMemberDtoSchema>;

export const listSchoolMembersInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  searchQuery: z.string().trim().min(1).max(200).optional(),
  orderBy: z
    .object({
      field: z.enum(["name", "email", "addedAt"]),
      direction: z.enum(["asc", "desc"]).default("asc"),
    })
    .default({ field: "name", direction: "asc" }),
});

export const listSchoolMembersOutputSchema =
  createPaginatedOutputSchema(schoolMemberDtoSchema);

export const schoolMemberIdInputSchema = z.object({
  schoolId: z.string().min(1),
  userId: z.string().min(1),
});

export const updateSchoolMemberRolesInputSchema =
  schoolMemberIdInputSchema.extend({
    roles: schoolRoleAssignmentsSchema,
  });
