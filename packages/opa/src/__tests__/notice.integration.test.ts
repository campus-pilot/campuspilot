import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isAuthorized,
  type AuthorizationInput,
  type RoleAssignment,
} from "../authorization";
import { OpaClient } from "../client";
import { SCHOOL_ACTIONS } from "../generated/school";
import { startOpaContainer, type RunningOpaContainer } from "./opa-container";

describe("Notice authorization with real OPA", () => {
  let running: RunningOpaContainer;
  let client: OpaClient;
  beforeAll(async () => {
    running = await startOpaContainer();
    client = new OpaClient(running.url);
  }, 45000);
  afterAll(async () => {
    if (running) await running.stop();
  });

  const ALL_ROLES = ["school.principal", "school.manager", "school.teacher", "school.accountant", "school.exam_coordinator"];
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

  it("lets every staff role read notices and write drafts in its own school only", async () => {
    for (const name of ALL_ROLES) {
      for (const action of [SCHOOL_ACTIONS.READ_NOTICE, SCHOOL_ACTIONS.DRAFT_NOTICE]) {
        expect(await allowed(action, role(name)), `${name} ${action}`).toBe(true);
        expect(await allowed(action, role(name, "school-2")), `${name} ${action} other school`).toBe(false);
      }
    }
  });

  it("lets only principal and manager publish, and routes notice failure alerts to them", async () => {
    for (const name of ["school.principal", "school.manager"]) {
      expect(await allowed(SCHOOL_ACTIONS.PUBLISH_NOTICE, role(name)), name).toBe(true);
      expect(await allowed(SCHOOL_ACTIONS.PUBLISH_NOTICE, role(name, "school-2")), name).toBe(false);
      expect(await allowed(SCHOOL_ACTIONS.RECEIVE_NOTICE_NOTIFICATION_FAILURES, role(name)), name).toBe(true);
    }
    for (const name of ["school.teacher", "school.accountant", "school.exam_coordinator"]) {
      expect(await allowed(SCHOOL_ACTIONS.PUBLISH_NOTICE, role(name)), name).toBe(false);
      expect(await allowed(SCHOOL_ACTIONS.RECEIVE_NOTICE_NOTIFICATION_FAILURES, role(name)), name).toBe(false);
    }
  });

  it("gives a platform administrator no notice access", async () => {
    const admin = { role: "platform.admin", scope: { kind: "platform" } } as RoleAssignment;
    for (const action of [SCHOOL_ACTIONS.READ_NOTICE, SCHOOL_ACTIONS.DRAFT_NOTICE, SCHOOL_ACTIONS.PUBLISH_NOTICE]) {
      expect(await allowed(action, admin), action).toBe(false);
    }
  });
});
