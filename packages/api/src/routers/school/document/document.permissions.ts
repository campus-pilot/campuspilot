import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";

import { isFinanceDocumentType, type DocumentType } from "./document.dto";

/**
 * The reads of a document type's source data (its template and the records
 * it prints), checked besides its generate action. Decided by the type alone
 * (no source field changes it), so starting, reading and listing jobs share
 * one rule. Template previews put a part of the school's real data into
 * their context only when the caller holds that part's reads from this list
 * (`document.preview-context.ts`), so a preview never shows more than
 * generating the document would.
 */
export function sourceReadActions(type: DocumentType) {
  if (isFinanceDocumentType(type))
    return [
      SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES,
      SCHOOL_ACTIONS.READ_SESSION_FINANCE,
      SCHOOL_ACTIONS.READ_ADMISSION_LEDGER,
    ];
  const sourceReads =
    type === "timetable"
      ? [SCHOOL_ACTIONS.READ_EXAM_TIMETABLE, SCHOOL_ACTIONS.READ_EXAMS]
      : type === "report_card"
        ? [SCHOOL_ACTIONS.READ_STUDENT, SCHOOL_ACTIONS.READ_EXAM_RESULTS, SCHOOL_ACTIONS.READ_EXAMS, SCHOOL_ACTIONS.READ_EXAM_PLANS]
        : type === "admit_card"
          ? [SCHOOL_ACTIONS.READ_STUDENT, SCHOOL_ACTIONS.READ_EXAM_TIMETABLE, SCHOOL_ACTIONS.READ_EXAMS]
          : [SCHOOL_ACTIONS.READ_STUDENT];
  return [
    SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES,
    SCHOOL_ACTIONS.READ_SESSION,
    SCHOOL_ACTIONS.READ_CLASS,
    ...sourceReads,
  ];
}
