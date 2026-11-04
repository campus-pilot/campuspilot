import { describe, expect, it } from "vitest";

import { listAdmissionsInputSchema } from "./admission.dto";

describe("listAdmissionsInputSchema", () => {
  it("defaults to contains search for existing callers", () => {
    const input = listAdmissionsInputSchema.parse({ schoolId: "school-1" });

    expect(input.searchMode).toBe("contains");
    expect(input.orderBy).toEqual({ field: "name", direction: "asc" });
  });

  it("requires a non-empty search query for relevance ordering", () => {
    const input = {
      schoolId: "school-1",
      orderBy: { field: "relevance", direction: "desc" },
    } as const;

    expect(listAdmissionsInputSchema.safeParse(input).success).toBe(false);
    expect(
      listAdmissionsInputSchema.safeParse({ ...input, searchQuery: "   " })
        .success,
    ).toBe(false);
    expect(
      listAdmissionsInputSchema.safeParse({ ...input, searchQuery: "Clara" })
        .success,
    ).toBe(true);
  });

  it("requires descending direction for the fixed relevance ranking", () => {
    const input = {
      schoolId: "school-1",
      searchQuery: "Clara",
      orderBy: { field: "relevance", direction: "asc" },
    } as const;

    const result = listAdmissionsInputSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: "Relevance ordering has a fixed descending direction.",
          path: ["orderBy", "direction"],
        }),
      );
    }
  });
});
