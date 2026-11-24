import type { Database } from "@campuspilot/db";
import type { DocumentLedgerCutoff } from "@campuspilot/db/schema/document-generation-job";
import type { artifactTable } from "@campuspilot/db/schema/artifact";
import {
  isFinanceDocumentType,
  type DocumentSource,
} from "./document.dto";
import {
  buildDocumentContexts,
  type DocumentContextOptions,
} from "./document.context";
import { buildFinanceDocumentContexts } from "./finance-document.context";

type FinanceSource = Extract<DocumentSource, { documentType: "bill" | "receipt" | "statement" | "bill_due" }>;
type AcademicSource = Exclude<DocumentSource, FinanceSource>;

/** What a document source resolves to, the same shape for academic and finance documents. */
export type ResolvedDocumentSource = {
  /** One per document, in print order. */
  contexts: object[];
  name: string;
  /** Academic documents: the students included (empty for timetables and finance documents). */
  studentIds: string[];
  warnings: string[];
  financeSource: (typeof artifactTable.$inferSelect)["financeSource"];
  /** Statements and Bills due only. */
  reviewHash: string | null;
  /** Finance documents only: the per-account high-water sequences read (or the pinned ones). */
  ledgerCutoff: DocumentLedgerCutoff[] | null;
};

/**
 * Builds every context of `source` in one repeatable-read, read-only
 * transaction, so all documents describe the same moment. The academic and
 * finance builders keep their own rules; this only gives their results one
 * shape. Used by previews, by `generateDocument` to validate a request
 * before it queues a job, and by the job itself.
 */
export async function resolveDocumentSource(
  db: Database,
  schoolId: string,
  source: DocumentSource,
  options: DocumentContextOptions & { ledgerCutoff?: readonly DocumentLedgerCutoff[] },
): Promise<ResolvedDocumentSource> {
  if (isFinanceDocumentType(source.documentType)) {
    const data = await db.transaction(
      (tx) => buildFinanceDocumentContexts(tx, schoolId, source as FinanceSource, options),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    return {
      contexts: data.contexts,
      name: data.name,
      studentIds: [],
      // A Bill due names the students it leaves out; the other finance documents have no warnings.
      warnings: "warnings" in data ? data.warnings : [],
      financeSource: data.financeSource,
      reviewHash: data.reviewHash,
      ledgerCutoff: data.ledgerCutoff,
    };
  }
  const data = await db.transaction(
    (tx) => buildDocumentContexts(tx, schoolId, source as AcademicSource, options),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return {
    contexts: data.contexts,
    name: data.name,
    studentIds: data.studentIds,
    warnings: data.warnings,
    financeSource: null,
    reviewHash: null,
    ledgerCutoff: null,
  };
}

/** The artifact provenance a source fixes (examination, class and report options), as generation has always recorded it. */
export function sourceProvenance(source: DocumentSource) {
  return {
    sessionId: source.sessionId,
    examSlug: "examSlug" in source ? source.examSlug : null,
    classId: "classId" in source ? (source.classId ?? null) : null,
    generationOptions:
      source.documentType === "report_card"
        ? { reportSections: source.reportSections, resultPolicy: source.resultPolicy }
        : {},
  };
}
