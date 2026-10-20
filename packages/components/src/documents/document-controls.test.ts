import { describe, expect, it } from "vitest";
import {
  allDocumentKinds,
  workspaceDocumentKinds,
} from "./document-controls";

describe("document kind collections", () => {
  it("keeps account statements contextual while exposing bills and receipts", () => {
    expect(workspaceDocumentKinds.map(({ value }) => value)).toEqual([
      "report_card",
      "id_card",
      "admit_card",
      "timetable",
      "bill",
      "receipt",
    ]);
    expect(
      workspaceDocumentKinds.find(({ value }) => value === "receipt")
        ?.description,
    ).toBe("Posted payment receipts");
    expect(
      allDocumentKinds.find(({ value }) => value === "receipt")?.description,
    ).toBe("Payments and refunds");
    expect(allDocumentKinds.map(({ value }) => value)).toContain("statement");
  });
});
