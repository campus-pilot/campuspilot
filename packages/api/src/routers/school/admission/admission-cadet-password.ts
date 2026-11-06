import { issueCadetLogin } from "@campuspilot/auth/cadet-login";
import type { DatabaseExecutor } from "@campuspilot/db";
import { schoolTable } from "@campuspilot/db/schema/school";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { rpcError } from "../../../errors";

/**
 * What staff see exactly once after a Cadet Portal password is issued: the
 * three values the student types at sign-in. The password is never stored
 * in plain text and can never be viewed again; staff can only issue a new
 * one. `schoolSlug` and `admissionNo` are read at issue time for display
 * only; the auth level never stores the admission number.
 */
export const issuedCadetPasswordSchema = z.object({
  schoolSlug: z.string(),
  admissionNo: z.string(),
  password: z.string(),
});

export type IssuedCadetPassword = z.infer<typeof issuedCadetPasswordSchema>;

/**
 * Issues a new Cadet Portal password for an admission inside the caller's
 * transaction (creating the login on first issue) and returns what the
 * student needs to sign in. The caller has already verified that the
 * admission belongs to `schoolId`.
 */
export async function issueAdmissionCadetPassword(
  executor: DatabaseExecutor,
  input: {
    schoolId: string;
    admission: { id: string; admissionNo: string };
    issuedBy: string;
  },
): Promise<{ userId: string; issued: IssuedCadetPassword }> {
  const [school] = await executor
    .select({ slug: schoolTable.slug })
    .from(schoolTable)
    .where(eq(schoolTable.id, input.schoolId))
    .limit(1);
  if (!school) throw rpcError.notFound("School");

  const login = await issueCadetLogin(executor, {
    admissionId: input.admission.id,
    issuedBy: input.issuedBy,
  });
  return {
    userId: login.userId,
    issued: {
      schoolSlug: school.slug,
      admissionNo: input.admission.admissionNo,
      password: login.password,
    },
  };
}
