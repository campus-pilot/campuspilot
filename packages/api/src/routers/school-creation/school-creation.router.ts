import { z } from "zod";

import { toRpcError } from "../../errors";
import { protectedProcedure } from "../../index";
import {
  createOwnSchool,
  readLatestSchoolCreationRequest,
  readSchoolCreationStatus,
  requestLargerSchoolLimit,
} from "../../school-creation/school-creation.service";
import {
  createOwnSchoolInputSchema,
  createOwnSchoolOutputSchema,
  requestMoreSchoolsInputSchema,
  schoolCreationStatusDtoSchema,
} from "./school-creation.dto";

/**
 * Self-service school creation for any signed-in staff account
 * (docs/school-creation.md), mounted as `schoolCreation` beside `school`
 * because nothing here is scoped to a school. None of these take a
 * `schoolId`: they act on the signed-in person, so the server decides
 * everything from that person's own facts. They are hidden from MCP and
 * the assistant: opening a school and asking CampusPilot for more are human
 * decisions.
 */
export const schoolCreationRouter = {
  getStatus: protectedProcedure
    .route({
      summary: "Get my school creation allowance",
      description:
        "Whether the signed-in person may create a school, how many they may create and have created, and their latest request for more.",
      tags: ["School"],
    })
    .meta({
      mcp: { exposure: "hidden", access: "read", destructive: false, module: "schools" },
    })
    .output(schoolCreationStatusDtoSchema)
    .handler(async ({ context }) => {
      try {
        const userId = context.session.user.id;
        const status = await readSchoolCreationStatus(context.db, userId);
        const latestRequest = await readLatestSchoolCreationRequest(context.db, userId);
        return schoolCreationStatusDtoSchema.parse({ ...status, latestRequest });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createSchool: protectedProcedure
    .route({
      summary: "Create my school",
      description:
        "Create a school owned by the signed-in person, who becomes its principal. It starts on a 28-day trial (one billing period) of the smallest tier with the AI assistant switched on under a limit per billing period. Refused with data.reason SCHOOL_CREATION_REFUSED when the person may not create one.",
      tags: ["School"],
    })
    .meta({
      mcp: { exposure: "hidden", access: "write", destructive: false, module: "schools" },
    })
    .input(createOwnSchoolInputSchema)
    .output(createOwnSchoolOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction((transaction) =>
          createOwnSchool(transaction, {
            userId: context.session.user.id,
            name: input.name,
            location: input.location,
            registrationNo: input.registrationNo || null,
            now: new Date(),
          }),
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  requestMore: protectedProcedure
    .route({
      summary: "Ask to create more schools",
      description:
        "Ask CampusPilot for a larger school creation allowance: the total wanted and why. A platform administrator approves or rejects it. One request may be pending at a time.",
      tags: ["School"],
    })
    .meta({
      mcp: { exposure: "hidden", access: "write", destructive: false, module: "schools" },
    })
    .input(requestMoreSchoolsInputSchema)
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ context, input }) => {
      try {
        await context.db.transaction((transaction) =>
          requestLargerSchoolLimit(transaction, {
            userId: context.session.user.id,
            requestedLimit: input.requestedLimit,
            reason: input.reason,
          }),
        );
        return { ok: true as const };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
