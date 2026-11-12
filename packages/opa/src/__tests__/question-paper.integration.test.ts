import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isAuthorized,
  type AuthorizationInput,
  type RoleAssignment,
} from "../authorization";
import { OpaClient } from "../client";
import { CLASS_ACTIONS } from "../generated/class";
import { startOpaContainer, type RunningOpaContainer } from "./opa-container";

describe("Question paper authorization with real OPA", () => {
  let running: RunningOpaContainer;
  let client: OpaClient;
  beforeAll(async () => {
    running = await startOpaContainer();
    client = new OpaClient(running.url);
  }, 45000);
  afterAll(async () => {
    if (running) await running.stop();
  });
  const actions = [
    CLASS_ACTIONS.READ_EXAM_QUESTION_PAPERS,
    CLASS_ACTIONS.MANAGE_EXAM_QUESTION_PAPERS,
  ] as const;
  function input(
    action: AuthorizationInput["action"],
    assignment: RoleAssignment,
  ): AuthorizationInput {
    return {
      action,
      subject: { userId: "u1", roleAssignments: [assignment] },
      resource: { kind: "class", schoolId: "school-1", classId: "class-1" },
    } as AuthorizationInput;
  }
  const school = { kind: "school", schoolId: "school-1" } as const;
  const allowed = (action: (typeof actions)[number], a: RoleAssignment) =>
    isAuthorized(input(action, a), { client });

  it("allows teachers only for their own classes", async () => {
    for (const action of actions) {
      expect(
        await allowed(action, {
          role: "school.teacher",
          scope: school,
          meta: { classIds: ["class-1"] },
        }),
      ).toBe(true);
      for (const classIds of [[], ["class-2"]]) {
        expect(
          await allowed(action, {
            role: "school.teacher",
            scope: school,
            meta: { classIds },
          }),
        ).toBe(false);
      }
    }
  });

  it("allows principal, manager and exam coordinator across the school", async () => {
    for (const action of actions) {
      for (const role of ["principal", "manager", "exam_coordinator"] as const) {
        expect(
          await allowed(action, { role: `school.${role}`, scope: school, meta: null }),
        ).toBe(true);
        expect(
          await allowed(action, {
            role: `school.${role}`,
            scope: { kind: "school", schoolId: "school-2" },
            meta: null,
          }),
        ).toBe(false);
      }
    }
  });

  it("denies accountants and platform admins", async () => {
    for (const action of actions) {
      expect(
        await allowed(action, { role: "school.accountant", scope: school, meta: null }),
      ).toBe(false);
      expect(
        await allowed(action, {
          role: "platform.admin",
          scope: { kind: "platform" },
        }),
      ).toBe(false);
    }
  });
});
