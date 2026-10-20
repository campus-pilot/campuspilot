import { describe, expect, it } from "vitest";
import { documentSourceSchema, listArtifactsSchema } from "./document.dto";
import { DOCUMENT_MARKETPLACE, SAMPLE_DOCUMENT_CONTEXT } from "./document.catalog";
import { renderDocument } from "./document.render";
import { formatDocumentMoney } from "./finance-document.context";

describe("finance document contracts", () => {
  it("rejects duplicate immutable source IDs", () => {
    expect(documentSourceSchema.safeParse({ documentType: "bill", sessionId: "session", billIds: ["bill", "bill"] }).success).toBe(false);
    expect(documentSourceSchema.safeParse({ documentType: "receipt", sessionId: "session", transactions: [{ kind: "payment", id: "p" }, { kind: "payment", id: "p" }] }).success).toBe(false);
    expect(documentSourceSchema.safeParse({ documentType: "statement", sessionId: "session", admissionIds: ["a", "a"], throughDate: "2026-10-20" }).success).toBe(false);
  });

  it("supports one full billing run without accepting ambiguous bill scopes", () => {
    expect(documentSourceSchema.safeParse({ documentType: "bill", sessionId: "session", billRunId: "run" }).success).toBe(true);
    expect(documentSourceSchema.safeParse({ documentType: "bill", sessionId: "session" }).success).toBe(false);
    expect(documentSourceSchema.safeParse({ documentType: "bill", sessionId: "session", billRunId: "run", billIds: ["bill"] }).success).toBe(false);
  });

  it("makes combined history explicit without weakening exact type domains", () => {
    expect(
      listArtifactsSchema.parse({
        schoolId: "school",
        filters: { documentDomain: "all", sessionId: "session" },
      }).filters.documentDomain,
    ).toBe("all");
    expect(
      listArtifactsSchema.safeParse({
        schoolId: "school",
        filters: { documentDomain: "academic", documentType: "receipt" },
      }).success,
    ).toBe(false);
  });

  it("accepts only a real statement local date and keeps currency/time zone server-owned", () => {
    expect(documentSourceSchema.safeParse({ documentType: "statement", sessionId: "session", admissionIds: ["a"] }).success).toBe(false);
    expect(documentSourceSchema.safeParse({ documentType: "statement", sessionId: "session", admissionIds: ["a"], throughDate: "2026-02-30" }).success).toBe(false);
    expect(documentSourceSchema.safeParse({ documentType: "statement", sessionId: "session", admissionIds: ["a"], throughDate: "2026-10-20" }).success).toBe(true);
    expect(documentSourceSchema.safeParse({ documentType: "statement", sessionId: "session", admissionIds: ["a"], throughDate: "2026-10-20", currency: "USD", timeZone: "UTC" }).success).toBe(false);
  });

  it("keeps the global receipt selection payment-only without changing contextual receipts", () => {
    expect(
      documentSourceSchema.safeParse({
        documentType: "receipt",
        sessionId: "session",
        selectionPolicy: "posted_unreversed_payments",
        transactions: [{ kind: "payment", id: "payment" }],
      }).success,
    ).toBe(true);
    expect(
      documentSourceSchema.safeParse({
        documentType: "receipt",
        sessionId: "session",
        selectionPolicy: "posted_unreversed_payments",
        transactions: [{ kind: "refund", id: "refund" }],
      }).success,
    ).toBe(false);
    expect(
      documentSourceSchema.safeParse({
        documentType: "receipt",
        sessionId: "session",
        transactions: [{ kind: "refund", id: "refund" }],
      }).success,
    ).toBe(true);
  });

  it("formats signed exact money without malformed negative fractions", () => {
    expect(formatDocumentMoney(BigInt(-12500), "INR")).toBe("-125.00");
    expect(formatDocumentMoney(BigInt(-5), "INR")).toBe("-0.05");
    expect(formatDocumentMoney(BigInt(-5), "JPY")).toBe("-5");
  });

  it.each(["bill", "receipt", "statement"] as const)("renders the %s catalog template from documented synthetic data", (type) => {
    const template = DOCUMENT_MARKETPLACE.find((item) => item.documentType === type);
    expect(template).toBeDefined();
    const html = renderDocument(template!.content, SAMPLE_DOCUMENT_CONTEXT);
    expect(html).toContain("Greenwood Public School");
    expect(html).not.toContain("{{");
  });
});
