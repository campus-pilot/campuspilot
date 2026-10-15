import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isAuthorized,
  type AuthorizationInput,
  type RoleAssignment,
} from "../authorization";
import { OpaClient } from "../client";
import { SCHOOL_ACTIONS } from "../generated/school";
import { CLASS_ACTIONS } from "../generated/class";
import { startOpaContainer, type RunningOpaContainer } from "./opa-container";

describe("Exam authorization with real OPA", () => {
  let running: RunningOpaContainer;
  let client: OpaClient;
  beforeAll(async () => {
    running = await startOpaContainer();
    client = new OpaClient(running.url);
  }, 45000);
  afterAll(async () => {
    if (running) await running.stop();
  });
  function input(
    action: AuthorizationInput["action"],
    assignment: RoleAssignment,
    kind: "school" | "class" = "school",
  ): AuthorizationInput {
    return {
      action,
      subject: { userId: "u1", roleAssignments: [assignment] },
      resource:
        kind === "class"
          ? { kind, schoolId: "school-1", classId: "class-1" }
          : { kind, schoolId: "school-1" },
    } as AuthorizationInput;
  }
  const teacher: RoleAssignment = {
    role: "school.teacher",
    scope: { kind: "school", schoolId: "school-1" },
    meta: { classIds: [] },
  };
  const admin: RoleAssignment = {
    role: "platform.admin",
    scope: { kind: "platform" },
  };
  it("teachers write any class but only assigned teachers approve", async () => {
    expect(
      await isAuthorized(input(SCHOOL_ACTIONS.WRITE_EXAM_RESULTS, teacher), {
        client,
      }),
    ).toBe(true);
    expect(
      await isAuthorized(
        input(CLASS_ACTIONS.APPROVE_EXAM_RESULTS, teacher, "class"),
        { client },
      ),
    ).toBe(false);
    expect(
      await isAuthorized(
        input(
          CLASS_ACTIONS.APPROVE_EXAM_RESULTS,
          { ...teacher, meta: { classIds: ["class-1"] } },
          "class",
        ),
        { client },
      ),
    ).toBe(true);
    expect(
      await client.queryValidated(
        "campuspilot/authorization/decision",
        input(CLASS_ACTIONS.APPROVE_EXAM_RESULTS, teacher, "class"),
        z.object({ allowed: z.boolean() }),
      ),
    ).toEqual({ allowed: false });
  });
  it("only school administrators govern exams; platform admins view only", async () => {
    for (const role of ["principal", "manager", "exam_coordinator"] as const) {
      const staff: RoleAssignment = {
        role: `school.${role}`,
        scope: { kind: "school", schoolId: "school-1" },
        meta: null,
      };
      for (const action of [
        SCHOOL_ACTIONS.CREATE_EXAM_PLAN,
        SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN,
        SCHOOL_ACTIONS.UPDATE_EXAM_TIMETABLE,
        SCHOOL_ACTIONS.REVISE_EXAM_RESULTS,
      ]) {
        expect(await isAuthorized(input(action, staff), { client })).toBe(true);
        expect(await isAuthorized(input(action, teacher), { client })).toBe(
          false,
        );
        expect(await isAuthorized(input(action, admin), { client })).toBe(
          false,
        );
        expect(
          await isAuthorized(
            input(action, {
              ...staff,
              scope: { kind: "school", schoolId: "school-2" },
            }),
            { client },
          ),
        ).toBe(false);
      }
      expect(
        await isAuthorized(
          input(CLASS_ACTIONS.APPROVE_EXAM_RESULTS, staff, "class"),
          { client },
        ),
      ).toBe(true);
    }
    for (const action of [
      SCHOOL_ACTIONS.READ_EXAMS,
      SCHOOL_ACTIONS.READ_EXAM_PLANS,
      SCHOOL_ACTIONS.READ_EXAM_RESULTS,
      SCHOOL_ACTIONS.READ_EXAM_TIMETABLE,
    ]) {
      expect(await isAuthorized(input(action, admin), { client })).toBe(true);
      expect(
        await isAuthorized(
          input(action, {
            role: "school.accountant",
            scope: { kind: "school", schoolId: "school-1" },
            meta: null,
          }),
          { client },
        ),
      ).toBe(true);
    }
  });
});
