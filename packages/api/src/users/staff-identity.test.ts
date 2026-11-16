import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { phoneSearchPatterns, staffSignInSortKey } from "./staff-identity";

/** Whether some pattern is a substring of the stored number, as `ilike '%…%'` checks. */
function matches(stored: string, searchQuery: string) {
  return phoneSearchPatterns(searchQuery).some((digits) => stored.includes(digits));
}

describe("phoneSearchPatterns", () => {
  const stored = "+919876543210";

  it("finds a number typed with a national trunk 0, as login and invite accept it", () => {
    expect(matches(stored, "098765 43210")).toBe(true);
  });

  it("still finds part of a number, ignoring spaces and dashes", () => {
    expect(matches(stored, "98765 43210")).toBe(true);
    expect(matches(stored, "43-210")).toBe(true);
    expect(matches(stored, "+91 98765 43210")).toBe(true);
  });

  it("does not match another number", () => {
    expect(matches(stored, "098765 43211")).toBe(false);
  });
});

describe("staffSignInSortKey", () => {
  it("sorts phone-only accounts by their number, never by the placeholder email", () => {
    const { sql } = new PgDialect().sqlToQuery(staffSignInSortKey);
    expect(sql).toBe(
      'case when "user"."email_is_placeholder" then "user"."phone_number" else "user"."email" end',
    );
  });
});
