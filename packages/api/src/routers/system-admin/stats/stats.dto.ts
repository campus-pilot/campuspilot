import { z } from "zod";

const countSchema = z.number().int().nonnegative();

export const platformStatsOutputSchema = z.object({
  schools: z.object({
    total: countSchema,
    /** Schools whose `has_completed_onboarding` flag is set. */
    onboarded: countSchema,
    /** Schools whose `is_demo` flag is set, counted independently of onboarding. */
    demo: countSchema,
  }),
  oauthClients: z.object({
    total: countSchema,
    /** Clients explicitly disabled by an administrator. */
    disabled: countSchema,
  }),
  /** Distinct users holding at least one school membership. */
  staffMembers: countSchema,
  /** Admissions across every school that are still registered. */
  registeredAdmissions: countSchema,
  // TODO: add demo-request counts once the demo request feature exists.
});

export type PlatformStatsDto = z.infer<typeof platformStatsOutputSchema>;

export const schoolStatsInputSchema = z.object({ schoolId: z.string().min(1) });

const classStudentCountSchema = z.object({
  classId: z.string(),
  label: z.string(),
  students: countSchema,
});

export const schoolStatsOutputSchema = z.object({
  admissions: z.object({
    total: countSchema,
    registered: countSchema,
    unregistered: countSchema,
  }),
  staffMembers: countSchema,
  classes: countSchema,
  sections: countSchema,
  sessions: countSchema,
  /**
   * Enrolment in the school's active session, or null when no session is
   * active. Only aggregate counts are returned; never student records.
   */
  activeSession: z
    .object({
      id: z.string(),
      sessionStartYear: z.number().int(),
      sessionEndYear: z.number().int(),
      /** Student rows in the session whose admission is still registered. */
      enrolledStudents: countSchema,
      /** Enrolled students without a class assignment in this session. */
      studentsWithoutClass: countSchema,
      /** Enrolled students per class, in the school's class display order. */
      studentsByClass: z.array(classStudentCountSchema),
    })
    .nullable(),
});

export type SchoolStatsDto = z.infer<typeof schoolStatsOutputSchema>;

/**
 * What a platform administrator sees about a personal space
 * (docs/personal-space.md): its standalone papers and versions, what it
 * stores against its quota, and its AI spend in the current spend window
 * against the assistant's limit. A personal space has no staff, classes,
 * sessions or students, so the school counts do not apply to it.
 */
export const personalSpaceStatsOutputSchema = z.object({
  papers: countSchema,
  versions: countSchema,
  /** `personalSpaceStoredBytes`: page photos with their copies, figures and version PDFs. */
  storedBytes: countSchema,
  /** `PERSONAL_SPACE_STORAGE_QUOTA_BYTES`. */
  storageQuotaBytes: countSchema,
  aiSpend: z.object({
    /** USD as decimal text, the sum of the window's model request costs. */
    spentUsd: z.string(),
    /** Whether the space's assistant settings are valid; when not, its limit is not known. */
    settingsValid: z.boolean(),
    /** The assistant's limit per window in USD; null when it has none (or its settings are not valid). */
    monthlyLimitUsd: z.number().nullable(),
    windowStart: z.date(),
    windowEnd: z.date(),
  }),
});

export type PersonalSpaceStatsDto = z.infer<typeof personalSpaceStatsOutputSchema>;
