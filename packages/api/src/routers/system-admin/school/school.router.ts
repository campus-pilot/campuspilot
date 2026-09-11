import { schoolTable } from "@campuspilot/db/schema/school";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { toRpcError, rpcError } from "../../../errors";
import { systemAdminProcedure } from "../../../index";
import {
  addSchoolInputSchema,
  schoolDtoSchema,
  schoolIdInputSchema,
  toSchoolDto,
  updateSchoolInputSchema,
} from "./school.dto";

export const schoolRouter = {
  getSchools: systemAdminProcedure
    .output(z.array(schoolDtoSchema))
    .handler(async ({ context }) => {
      try {
        const schools = await context.db
          .select()
          .from(schoolTable)
          .orderBy(asc(schoolTable.name));
        return schools.map(toSchoolDto);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getSchool: systemAdminProcedure
    .input(schoolIdInputSchema)
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .select()
          .from(schoolTable)
          .where(eq(schoolTable.id, input.id))
          .limit(1);
        if (!school) throw rpcError.notFound("School");
        return toSchoolDto(school);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  addSchool: systemAdminProcedure
    .input(addSchoolInputSchema)
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db.insert(schoolTable).values(input).returning();
        if (!school) throw rpcError.internal();
        return toSchoolDto(school);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSchool: systemAdminProcedure
    .input(updateSchoolInputSchema)
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      const { id, ...changes } = input;
      try {
        const [school] = await context.db
          .update(schoolTable)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(schoolTable.id, id))
          .returning();
        if (!school) throw rpcError.notFound("School");
        return toSchoolDto(school);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteSchool: systemAdminProcedure
    .input(schoolIdInputSchema)
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .delete(schoolTable)
          .where(eq(schoolTable.id, input.id))
          .returning();
        if (!school) throw rpcError.notFound("School");
        return toSchoolDto(school);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
