import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isAuthorized,
  type AuthorizationInput,
  type RoleAssignment,
} from "../authorization";
import { OpaClient } from "../client";
import { SCHOOL_ACTIONS } from "../generated/school";
import { SYSTEM_ACTIONS } from "../generated/system";
import { startOpaContainer, type RunningOpaContainer } from "./opa-container";

describe("Assistant authorization with real OPA", () => {
  let running: RunningOpaContainer;
  let client: OpaClient;
  beforeAll(async () => {
    running = await startOpaContainer();
    client = new OpaClient(running.url);
  }, 45000);
  afterAll(async () => {
    if (running) await running.stop();
  });

  const ASSISTANT_ACTIONS = [
    SCHOOL_ACTIONS.READ_ASSISTANT_ACCESS,
    SCHOOL_ACTIONS.MANAGE_ASSISTANT_ACCESS,
    SCHOOL_ACTIONS.READ_ASSISTANT_USAGE,
  ];
  const role = (name: string, schoolId = "school-1"): RoleAssignment =>
    ({ role: name, scope: { kind: "school", schoolId }, meta: name === "school.teacher" ? { classIds: ["class-1"] } : null }) as RoleAssignment;
  const allowed = (action: AuthorizationInput["action"], assignment: RoleAssignment) =>
    isAuthorized(
      {
        action,
        subject: { userId: "u1", roleAssignments: [assignment] },
        resource: { kind: "school", schoolId: "school-1" },
      } as AuthorizationInput,
      { client },
    );

  it("lets principal and manager read and manage assistant access and read its usage, in their own school only", async () => {
    for (const name of ["school.principal", "school.manager"]) {
      for (const action of ASSISTANT_ACTIONS) {
        expect(await allowed(action, role(name)), `${name} ${action}`).toBe(true);
        expect(await allowed(action, role(name, "school-2")), `${name} ${action} other school`).toBe(false);
      }
    }
  });

  it("gives teachers, accountants and exam coordinators none of them", async () => {
    for (const name of ["school.teacher", "school.accountant", "school.exam_coordinator"]) {
      for (const action of ASSISTANT_ACTIONS) {
        expect(await allowed(action, role(name)), `${name} ${action}`).toBe(false);
      }
    }
  });

  it("lets only a platform administrator read platform assistant usage", async () => {
    const check = (assignment: RoleAssignment) =>
      isAuthorized(
        {
          action: SYSTEM_ACTIONS.READ_PLATFORM_ASSISTANT_USAGE,
          subject: { userId: "u1", roleAssignments: [assignment] },
          resource: { kind: "system" },
        } as AuthorizationInput,
        { client },
      );
    expect(await check({ role: "platform.admin", scope: { kind: "platform" } } as RoleAssignment)).toBe(true);
    expect(await check({ role: "platform.user", scope: { kind: "platform" } } as RoleAssignment)).toBe(false);
    expect(await check(role("school.principal"))).toBe(false);
  });
});
