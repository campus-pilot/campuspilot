import { sessionConfigSchema } from "@campuspilot/db/schema/jsonb/session-config";
import { z } from "zod";

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";

const sessionStartYearSchema = z.number().int();
const sessionEndYearSchema = z.number().int();

export const schoolSessionDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  sessionStartYear: sessionStartYearSchema,
  sessionEndYear: sessionEndYearSchema,
  sessionConfig: sessionConfigSchema.nullable(),
  isActive: z.boolean(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export type SchoolSessionDto = z.infer<typeof schoolSessionDtoSchema>;

export function toSchoolSessionDto(value: SchoolSessionDto): SchoolSessionDto {
  return schoolSessionDtoSchema.parse(value);
}

export const listSchoolSessionsInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  filters: z
    .object({
      isActive: z.boolean().optional(),
      startYears: z.array(z.number().int()).optional(),
      endYears: z.array(z.number().int()).optional(),
    })
    .optional(),
  orderBy: z
    .object({
      field: z.enum([
        "sessionStartYear",
        "sessionEndYear",
        "createdAt",
        "updatedAt",
      ]),
      direction: z.enum(["asc", "desc"]).default("desc"),
    })
    .default({ field: "sessionStartYear", direction: "desc" }),
});

export const listSchoolSessionsOutputSchema = createPaginatedOutputSchema(
  schoolSessionDtoSchema,
);

export const sessionFilterOptionsOutputSchema = z.object({
  startYears: z.array(z.number().int()),
  endYears: z.array(z.number().int()),
});

export type SessionFilterOptions = z.infer<
  typeof sessionFilterOptionsOutputSchema
>;


export const schoolSessionIdInputSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
});

export const createSchoolSessionInputSchema = z
  .object({
    schoolId: z.string().min(1),
    sessionStartYear: sessionStartYearSchema,
    sessionEndYear: sessionEndYearSchema,
    sessionConfig: sessionConfigSchema.nullable().optional(),
  })
  .refine(
    ({ sessionStartYear, sessionEndYear }) =>
      sessionEndYear > sessionStartYear,
    {
      message: "Session end year must be after its start year.",
      path: ["sessionEndYear"],
    },
  );

/**
 * The optimistic-concurrency token of `updateSession`: the session's
 * `updatedAt` (from `getSession` or `listSessions`) as the caller last read
 * it, as an ISO 8601 UTC instant, or null when that read had no `updatedAt`.
 * Optional so callers that do not edit a copy (MCP clients, the assistant,
 * scripts) keep working unchanged; a caller that submits a configuration it
 * edited from an earlier read must send it (see `session.contract.ts`).
 * Compared as an instant at millisecond precision, the precision the API
 * returns `updatedAt` in, so `2026-04-01T10:00:00Z` and
 * `2026-04-01T10:00:00.000Z` are the same token.
 */
const expectedUpdatedAtSchema = z.iso
  .datetime()
  .nullable()
  .optional()
  .describe(
    "updatedAt of the session as you last read it (getSession). When given and the session was changed since, the update is refused with CONFLICT (data.reason 'SESSION_STALE') and nothing is written; read the session again and resubmit. Recommended whenever sessionConfig is sent, because sessionConfig replaces every exam definition.",
  );

export const updateSchoolSessionInputSchema = schoolSessionIdInputSchema
  .extend({
    sessionStartYear: sessionStartYearSchema.optional(),
    sessionEndYear: sessionEndYearSchema.optional(),
    sessionConfig: sessionConfigSchema.nullable().optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine(
    ({
      schoolId: _schoolId,
      sessionId: _sessionId,
      expectedUpdatedAt: _expectedUpdatedAt,
      ...changes
    }) => Object.values(changes).some((value) => value !== undefined),
    { message: "At least one session field must be provided." },
  );
