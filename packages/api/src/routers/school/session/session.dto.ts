import { financeSchemaConfigSchema } from "@campuspilot/db/schema/jsonb/finance-config";
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
  financeConfig: financeSchemaConfigSchema.nullable(),
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
    financeConfig: financeSchemaConfigSchema.nullable().optional(),
  })
  .refine(
    ({ sessionStartYear, sessionEndYear }) =>
      sessionEndYear > sessionStartYear,
    {
      message: "Session end year must be after its start year.",
      path: ["sessionEndYear"],
    },
  );

export const updateSchoolSessionInputSchema = schoolSessionIdInputSchema
  .extend({
    sessionStartYear: sessionStartYearSchema.optional(),
    sessionEndYear: sessionEndYearSchema.optional(),
    sessionConfig: sessionConfigSchema.nullable().optional(),
    financeConfig: financeSchemaConfigSchema.nullable().optional(),
  })
  .refine(
    ({ schoolId: _schoolId, sessionId: _sessionId, ...changes }) =>
      Object.values(changes).some((value) => value !== undefined),
    { message: "At least one session field must be provided." },
  );
