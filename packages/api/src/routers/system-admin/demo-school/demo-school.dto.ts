import { z } from "zod";

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";
import { DEMO_SCHOOL_PURGE_STAGES } from "@campuspilot/db/schema/demo-school-job";

import { DEMO_SCHOOL_STEPS } from "../../../workflows/demo-school/constants";
import { demoSeedInputSchema } from "../../../workflows/demo-school/plan";
import { addSchoolInputSchema, schoolDtoSchema } from "../school/school.dto";

export const listDemoClassCatalogueInputSchema = createListInputSchema({
  orderBy: z
    .object({
      field: z.enum(["displayOrder"]),
      direction: z.enum(["asc", "desc"]).default("asc"),
    })
    .default({ field: "displayOrder", direction: "asc" }),
});

export const demoClassDtoSchema = z.object({
  slug: z.string(),
  label: z.string(),
  displayOrder: z.number().int().positive(),
});

export const listDemoClassCatalogueOutputSchema =
  createPaginatedOutputSchema(demoClassDtoSchema);

/**
 * The dialog input. The slug is optional: when omitted it is derived from the
 * name, and in either case it is made unique with `-2`, `-3`, … The
 * registration number is kept unchanged when given (D2) and generated as a
 * random 12-digit number otherwise.
 */
export const createDemoSchoolInputSchema = z
  .object({
    name: addSchoolInputSchema.shape.name,
    slug: addSchoolInputSchema.shape.slug
      .optional()
      .describe("Preferred URL slug; a -2, -3… suffix is added if it is taken."),
    location: addSchoolInputSchema.shape.location,
    registrationNo: z.string().trim().min(1).max(100).optional(),
    sessionStartYear: z.number().int().min(2000).max(2100),
    sessionEndYear: z.number().int().min(2001).max(2101),
    cycleStartMonth: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(4)
      .describe("Month (1-12) the session and billing cycle start; April by default."),
    classSlugs: z
      .array(z.string().min(1))
      .min(1)
      .max(50)
      .describe("Class slugs from listDemoClassCatalogue."),
  })
  .superRefine((value, context) => {
    const seed = demoSeedInputSchema.safeParse({
      sessionStartYear: value.sessionStartYear,
      sessionEndYear: value.sessionEndYear,
      cycleStartMonth: value.cycleStartMonth,
      classSlugs: value.classSlugs,
    });
    for (const issue of seed.error?.issues ?? []) {
      context.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  });

export const demoSchoolJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export const demoSchoolStepSchema = z.enum(DEMO_SCHOOL_STEPS);

export const demoSchoolJobDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  status: demoSchoolJobStatusSchema,
  /** Every product step in order, for the progress list. */
  steps: z.array(demoSchoolStepSchema),
  currentStep: demoSchoolStepSchema.nullable(),
  completedSteps: z.array(demoSchoolStepSchema),
  attempt: z.number().int().positive(),
  error: z.object({ step: z.string(), message: z.string() }).nullable(),
  /** Present once the job has succeeded. The credentials key is never exposed. */
  summary: z
    .object({
      counts: z.object({
        staff: z.number().int(),
        classes: z.number().int(),
        students: z.number().int(),
        unregistered: z.number().int(),
        bills: z.number().int(),
        payments: z.number().int(),
        adjustments: z.number().int(),
        templates: z.number().int(),
      }),
      amounts: z.object({
        currency: z.string(),
        billedMinor: z.string(),
        collectedMinor: z.string(),
        outstandingMinor: z.string(),
      }),
      hasCredentials: z.boolean(),
    })
    .nullable(),
  asOf: z.date().nullable(),
  createdAt: z.date(),
  /** When the admin asked to start this attempt; null while only created (e.g. during the logo upload). */
  startRequestedAt: z.date().nullable(),
  /** When Restate durably accepted this attempt's start; a worker may not have picked it up yet. */
  submittedAt: z.date().nullable(),
  /** Why the last hand-over to Restate failed, while it is retried. */
  lastSubmitError: z.string().nullable(),
  /** Set once a purge of this school was requested; the job can no longer run. */
  purgeRequestedAt: z.date().nullable(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
});

export type DemoSchoolJobDto = z.infer<typeof demoSchoolJobDtoSchema>;

export const demoSchoolJobIdInputSchema = z.object({
  jobId: z.string().min(1),
});

export const demoSchoolIdInputSchema = z.object({
  schoolId: z.string().min(1),
});

export const createDemoSchoolOutputSchema = z.object({
  school: schoolDtoSchema,
  job: demoSchoolJobDtoSchema,
});

export const demoCredentialsDownloadDtoSchema = z.object({
  url: z.url(),
  fileName: z.string(),
  expiresAt: z.date(),
});

export const purgeDemoSchoolInputSchema = z.object({
  schoolId: z.string().min(1),
  confirmation: z
    .string()
    .min(1)
    .describe("The school's slug, typed exactly to confirm the purge."),
});

export const demoSchoolPurgeStageSchema = z.enum(DEMO_SCHOOL_PURGE_STAGES);

/** One demo purge request and its progress. Survives the school it purged. */
export const demoSchoolPurgeDtoSchema = z.object({
  schoolId: z.string(),
  /** The school's name and slug when the purge was requested (null for purges from before 0028). */
  schoolName: z.string().nullable(),
  schoolSlug: z.string().nullable(),
  /** `pending`: not yet accepted by Restate; `scheduled`: accepted and running. */
  status: z.enum(["pending", "scheduled", "completed", "failed"]),
  /** Every stage in order, for the progress view. */
  stages: z.array(demoSchoolPurgeStageSchema),
  /** The running stage, or where a failed attempt stopped. */
  stage: demoSchoolPurgeStageSchema.nullable(),
  attempt: z.number().int().positive(),
  /** True while a failed purge will still be retried automatically. */
  automaticRetryPending: z.boolean(),
  error: z.string().nullable(),
  /** Why the last hand-over to Restate failed, while it is retried. */
  lastSubmitError: z.string().nullable(),
  dataDeletedAt: z.date().nullable(),
  createdAt: z.date(),
  scheduledAt: z.date().nullable(),
  completedAt: z.date().nullable(),
});

export type DemoSchoolPurgeDto = z.infer<typeof demoSchoolPurgeDtoSchema>;

/** The purge request as recorded; the work runs in the background (watchDemoSchoolPurge). */
export const purgeDemoSchoolOutputSchema = demoSchoolPurgeDtoSchema;

export const listDemoSchoolPurgesInputSchema = createListInputSchema({
  filters: z
    .object({
      /** Only purges that need an admin: failed, or not yet handed over with an error. */
      needsAttention: z.boolean().default(true),
    })
    .default({ needsAttention: true }),
  orderBy: z
    .object({
      field: z.enum(["createdAt"]),
      direction: z.enum(["asc", "desc"]).default("desc"),
    })
    .default({ field: "createdAt", direction: "desc" }),
});

export const listDemoSchoolPurgesOutputSchema = createPaginatedOutputSchema(demoSchoolPurgeDtoSchema);
