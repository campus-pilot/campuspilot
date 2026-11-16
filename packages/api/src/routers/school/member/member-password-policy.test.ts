import { describe, expect, it } from "vitest";

import {
  grantsPrincipalRole,
  mayReceiveIssuedPassword,
} from "./member-password-policy";

describe("grantsPrincipalRole", () => {
  it("is true when a manager would make themselves a principal", () => {
    expect(grantsPrincipalRole(["manager"], ["manager", "principal"])).toBe(true);
  });

  it("is true when inviting someone as a principal", () => {
    expect(grantsPrincipalRole([], ["principal"])).toBe(true);
  });

  it("is false when an existing principal keeps or loses the role", () => {
    expect(grantsPrincipalRole(["principal"], ["principal", "teacher"])).toBe(false);
    expect(grantsPrincipalRole(["principal"], ["teacher"])).toBe(false);
  });

  it("is false for changes that never involve the principal role", () => {
    expect(grantsPrincipalRole(["teacher"], ["teacher", "accountant"])).toBe(false);
  });
});

describe("mayReceiveIssuedPassword", () => {
  it("allows only a signed-in person", () => {
    expect(mayReceiveIssuedPassword({ authMethod: "session" })).toBe(true);
  });

  it("refuses AI apps, API keys and the assistant", () => {
    expect(
      mayReceiveIssuedPassword({
        authMethod: "oauth",
        oauthGrant: {} as never,
      }),
    ).toBe(false);
    expect(mayReceiveIssuedPassword({ authMethod: "apiKey" })).toBe(false);
    expect(
      mayReceiveIssuedPassword({
        authMethod: "assistant",
        assistantRun: { conversationId: "c", runId: "r", schoolId: "s" },
      }),
    ).toBe(false);
  });
});
