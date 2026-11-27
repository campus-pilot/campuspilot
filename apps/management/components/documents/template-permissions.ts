import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { isFinanceDocumentType, type DocumentType } from '@campuspilot/api/routers/school/document/document.dto';

/**
 * The permissions that read and manage a type's school template. Finance
 * types (the API's `FINANCE_DOCUMENT_TYPES`, the one list of them) have their
 * own; every other type uses the academic ones. Every screen and sidebar
 * decides a template permission from here, so none can disagree about which
 * types are finance. Kept free of React and the API client so navigation
 * builders and unit tests can import it.
 */
export const templateReadAction = (type: DocumentType) =>
  isFinanceDocumentType(type)
    ? SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES
    : SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES;
export const templateManageAction = (type: DocumentType) =>
  isFinanceDocumentType(type)
    ? SCHOOL_ACTIONS.MANAGE_FINANCE_DOCUMENT_TEMPLATES
    : SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES;
