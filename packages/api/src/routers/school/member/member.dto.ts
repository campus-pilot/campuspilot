import { z } from "zod";
import { phoneNumberSchema } from "@campuspilot/db/phone";
import { STAFF_PLACEHOLDER_EMAIL_DOMAIN } from "@campuspilot/auth/staff-login-policy";
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

/** A real sign-in email; placeholder addresses can never be entered. */
export const staffEmailSchema = z
  .email()
  .transform((email) => email.toLowerCase())
  .refine((email) => !email.endsWith(`@${STAFF_PLACEHOLDER_EMAIL_DOMAIN}`), {
    message: "Enter the person's own email address.",
  });

/**
 * Invites by exactly one sign-in identifier. An email invitee signs in with
 * Google or a password they add later. A phone number creates an account
 * that can only sign in with a password, so a new phone account is issued
 * one (returned once as `issuedPassword`); that also needs the separate
 * password permission. A flat object because MCP tools need a top-level
 * object input; sending both or neither is a validation error.
 */
export const inviteSchoolMemberInputSchema = z
  .object({
    schoolId: z.string().min(1),
    email: staffEmailSchema.optional(),
    phoneNumber: phoneNumberSchema.optional(),
    roles: schoolRoleAssignmentsSchema,
  })
  .refine(
    ({ email, phoneNumber }) => (email === undefined) !== (phoneNumber === undefined),
    { message: "Provide either an email address or a phone number.", path: ["email"] },
  );

export const schoolMemberDtoSchema = z.object({
  schoolId: z.string(),
  userId: z.string(),
  name: z.string(),
  /** Null when the account has no email of its own (phone-only sign-in). */
  email: z.email().nullable(),
  /** Sign-in phone number in E.164, or null. */
  phoneNumber: z.string().nullable(),
  profileImageUrl: z.url().nullable(),
  addedAt: z.date(),
  /**
   * The member owns the school (`school.owner_user_id`, docs/school-creation.md):
   * they cannot be removed and always keep the principal role.
   */
  isOwner: z.boolean(),
  roles: z.array(schoolRoleAssignmentSchema),
});

export type SchoolMemberDto = z.infer<typeof schoolMemberDtoSchema>;

export const inviteSchoolMemberOutputSchema = schoolMemberDtoSchema.extend({
  /**
   * The new account's password, returned only when this invitation created a
   * phone-number account. Shown once; only its hash is stored. Null for email
   * invitations and for people who already had an account.
   */
  issuedPassword: z.string().nullable(),
});

/** What staff need to hand a person their new password, shown once. */
export const issuedStaffPasswordSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.email().nullable(),
  phoneNumber: z.string().nullable(),
  password: z.string(),
});

export type IssuedStaffPassword = z.infer<typeof issuedStaffPasswordSchema>;

export const listSchoolMembersInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  searchQuery: z.string().trim().min(1).max(200).optional(),
  filters: z
    .object({
      role: roleEnum.optional(),
      classId: z.string().min(1).optional(),
      excludeClassId: z.string().min(1).optional(),
    })
    .refine(
      ({ classId, excludeClassId }) =>
        classId === undefined || excludeClassId === undefined,
      { message: "Class inclusion and exclusion filters cannot be combined." },
    )
    .optional(),
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
