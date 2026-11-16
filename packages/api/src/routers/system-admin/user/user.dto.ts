import { z } from "zod";
import { phoneNumberSchema } from "@campuspilot/db/phone";
import {
  STAFF_MAX_PASSWORD_LENGTH,
  STAFF_MIN_PASSWORD_LENGTH,
} from "@campuspilot/auth/staff-login-policy";

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";
import { staffEmailSchema } from "../../school/member/member.dto";

export { issuedStaffPasswordSchema } from "../../school/member/member.dto";

export const platformUserDtoSchema = z.object({
  userId: z.string(),
  name: z.string(),
  /** Null when the account has no email of its own (phone-only sign-in). */
  email: z.email().nullable(),
  /** Sign-in phone number in E.164, or null. */
  phoneNumber: z.string().nullable(),
  /** Whether a password is set (phone and email sign-in share it). */
  hasPassword: z.boolean(),
  /** Whether the account can also sign in with Google. */
  hasGoogle: z.boolean(),
  /** Schools the person is a member of, by name. */
  schools: z.array(z.object({ schoolId: z.string(), name: z.string() })),
  createdAt: z.date(),
});

export type PlatformUserDto = z.infer<typeof platformUserDtoSchema>;

export const listUsersInputSchema = createListInputSchema({
  /** Matches name, email or phone number (spaces and dashes ignored). */
  searchQuery: z.string().trim().min(1).max(200).optional(),
  orderBy: z
    .object({
      field: z.enum(["name", "createdAt"]),
      direction: z.enum(["asc", "desc"]).default("asc"),
    })
    .default({ field: "name", direction: "asc" }),
});

export const listUsersOutputSchema =
  createPaginatedOutputSchema(platformUserDtoSchema);

/**
 * Sets a person's password. Leave `password` out to have one generated.
 * Either way it is returned once and the person is signed out everywhere.
 */
export const setUserPasswordInputSchema = z.object({
  userId: z.string().min(1),
  password: z
    .string()
    .min(
      STAFF_MIN_PASSWORD_LENGTH,
      `Password must contain at least ${STAFF_MIN_PASSWORD_LENGTH} characters.`,
    )
    .max(STAFF_MAX_PASSWORD_LENGTH)
    .optional(),
});

/**
 * The complete set of sign-in identifiers after the update. `email: null`
 * means the account keeps having no email of its own; a real email can be
 * changed but not removed. `phoneNumber: null` removes the number, which is
 * only allowed while the account has a real email.
 */
export const updateUserSignInInputSchema = z
  .object({
    userId: z.string().min(1),
    email: staffEmailSchema.nullable(),
    phoneNumber: phoneNumberSchema.nullable(),
  })
  .refine(({ email, phoneNumber }) => email !== null || phoneNumber !== null, {
    message: "Enter an email address or a phone number.",
    path: ["phoneNumber"],
  });
