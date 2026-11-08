import {
  SCHOOL_ACTIONS,
  type PermissionCheck,
} from '@campuspilot/api/routers/authorization/authorization.dto';

/**
 * Which header actions an admission offers before permissions are checked.
 * Edit and unregister apply to registered admissions only. The Cadet Portal
 * password is offered for unregistered admissions too, because portal access
 * is a separate fact from registration.
 */
export function admissionActionsFor(admission: { registered: boolean }) {
  return {
    edit: admission.registered,
    unregister: admission.registered,
    issuePortalPassword: true,
  };
}

/** The permission that gates the overflow menu's "Issue portal password". */
export function issuePortalPasswordPermission(schoolId: string): PermissionCheck {
  return {
    action: SCHOOL_ACTIONS.ISSUE_ADMISSION_CADET_PASSWORD,
    resource: { kind: 'school', schoolId },
  };
}

/**
 * Confirmation copy for issuing a Cadet Portal password. The admission DTO
 * does not say whether a login exists yet, so one wording must be true both
 * for a first password and for a reset.
 */
export function issuePortalPasswordConfirmation(studentName: string, pending: boolean) {
  return {
    title: 'Issue a new Cadet Portal password?',
    description: `${studentName} gets a new Cadet Portal password. If one was issued before, it stops working and ${studentName} is signed out of the Cadet Portal everywhere, including connected AI apps.`,
    confirmLabel: pending ? 'Issuing…' : 'Issue password',
  };
}
