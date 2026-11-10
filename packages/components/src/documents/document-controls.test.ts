import { describe, expect, it } from "vitest";
import {
  allDocumentKinds,
  noticeDocumentKind,
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

  it("keeps the notice template out of the generator and marketplace defaults", () => {
    // A notice has a template but no generator; the marketplace adds its card
    // only for schools with the notices feature.
    expect(workspaceDocumentKinds.map(({ value }) => value)).not.toContain("notice");
    expect(allDocumentKinds.map(({ value }) => value)).not.toContain("notice");
    expect(noticeDocumentKind).toMatchObject({ value: "notice", label: "Notices" });
  });
});
