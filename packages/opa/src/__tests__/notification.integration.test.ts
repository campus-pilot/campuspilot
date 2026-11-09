import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isAuthorized,
  type AuthorizationInput,
  type RoleAssignment,
} from "../authorization";
import { OpaClient } from "../client";
import { CLASS_ACTIONS } from "../generated/class";
import { SCHOOL_ACTIONS } from "../generated/school";
import { startOpaContainer, type RunningOpaContainer } from "./opa-container";

describe("Notification authorization with real OPA", () => {
  let running: RunningOpaContainer;
  let client: OpaClient;
  beforeAll(async () => {
    running = await startOpaContainer();
    client = new OpaClient(running.url);
  }, 45000);
  afterAll(async () => {
    if (running) await running.stop();
  });

  const role = (name: string, meta: { classIds: string[] } | null = null): RoleAssignment =>
    ({ role: name, scope: { kind: "school", schoolId: "school-1" }, meta }) as RoleAssignment;
  const allowed = (action: AuthorizationInput["action"], assignment: RoleAssignment, classId?: string) =>
    isAuthorized(
      {
        action,
        subject: { userId: "u1", roleAssignments: [assignment] },
        resource: classId ? { kind: "class", schoolId: "school-1", classId } : { kind: "school", schoolId: "school-1" },
      } as AuthorizationInput,
      { client },
    );

  it("publishes results as principal, manager, exam coordinator or accountant, never as a teacher", async () => {
    for (const name of ["school.principal", "school.manager", "school.exam_coordinator", "school.accountant"]) {
      expect(await allowed(SCHOOL_ACTIONS.SEND_NOTIFICATIONS, role(name)), name).toBe(true);
    }
    expect(await allowed(SCHOOL_ACTIONS.SEND_NOTIFICATIONS, role("school.teacher", { classIds: ["class-1"] }))).toBe(false);
    expect(await allowed(SCHOOL_ACTIONS.SEND_NOTIFICATIONS, { role: "platform.admin", scope: { kind: "platform" } })).toBe(false);
  });

  it("sends one student's result for any class, or a teacher's assigned classes only", async () => {
    for (const name of ["school.principal", "school.manager", "school.exam_coordinator", "school.accountant"]) {
      expect(await allowed(CLASS_ACTIONS.SEND_RESULT_NOTIFICATION, role(name), "class-7"), name).toBe(true);
    }
    const teacher = role("school.teacher", { classIds: ["class-1"] });
    expect(await allowed(CLASS_ACTIONS.SEND_RESULT_NOTIFICATION, teacher, "class-1")).toBe(true);
    expect(await allowed(CLASS_ACTIONS.SEND_RESULT_NOTIFICATION, teacher, "class-2")).toBe(false);
    expect(await allowed(CLASS_ACTIONS.SEND_RESULT_NOTIFICATION, role("school.teacher", { classIds: [] }), "class-1")).toBe(false);
  });

  it("reads the delivery log as a school administrator or accountant, and alerts accountants of failures", async () => {
    for (const name of ["school.principal", "school.manager", "school.exam_coordinator", "school.accountant"]) {
      expect(await allowed(SCHOOL_ACTIONS.READ_NOTIFICATION_LOG, role(name)), name).toBe(true);
    }
    expect(await allowed(SCHOOL_ACTIONS.READ_NOTIFICATION_LOG, role("school.teacher", { classIds: ["class-1"] }))).toBe(false);
    expect(await allowed(SCHOOL_ACTIONS.RECEIVE_NOTIFICATION_FAILURES, role("school.accountant"))).toBe(true);
    expect(await allowed(SCHOOL_ACTIONS.RECEIVE_NOTIFICATION_FAILURES, role("school.principal"))).toBe(false);
  });
});
