package campuspilot.authorization.catalog

import rego.v1

actions contains {
  "id": "school.logo.read",
  "key": "READ_LOGO",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.logo.update",
  "key": "UPDATE_LOGO",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.details.read",
  "key": "READ_DETAILS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.details.update",
  "key": "UPDATE_DETAILS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.member.invite",
  "key": "INVITE_MEMBER",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.member.list",
  "key": "LIST_MEMBERS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.member.read",
  "key": "READ_MEMBER",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.member.roles.update",
  "key": "UPDATE_MEMBER_ROLES",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.member.remove",
  "key": "REMOVE_MEMBER",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.session.list",
  "key": "LIST_SESSIONS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.session.read",
  "key": "READ_SESSION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.session.create",
  "key": "CREATE_SESSION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.session.update",
  "key": "UPDATE_SESSION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.session.delete",
  "key": "DELETE_SESSION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.session.activate",
  "key": "ACTIVATE_SESSION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.session.finance.read",
  "key": "READ_SESSION_FINANCE",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.session.finance.update",
  "key": "UPDATE_SESSION_FINANCE",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.finance.read",
  "key": "READ_ADMISSION_FINANCE",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.finance.update",
  "key": "UPDATE_ADMISSION_FINANCE",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.billing.run.read",
  "key": "READ_BILLING_RUNS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.billing.run.preview",
  "key": "PREVIEW_BILLING_RUN",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.billing.run.post",
  "key": "POST_BILLING_RUN",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.billing.bill.manual.create",
  "key": "CREATE_MANUAL_BILL",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.billing.bill.reverse",
  "key": "REVERSE_BILL",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.billing.run.reverse",
  "key": "REVERSE_BILLING_RUN",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.billing.report.read",
  "key": "READ_BILLING_REPORTS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.ledger.read",
  "key": "READ_ADMISSION_LEDGER",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.billing.payment.record",
  "key": "RECORD_PAYMENT",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.billing.adjustment.record",
  "key": "RECORD_FINANCE_ADJUSTMENT",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.billing.refund.record",
  "key": "RECORD_REFUND",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.ledger.reverse",
  "key": "REVERSE_LEDGER_ENTRY",
  "resourceKind": "school",
} if { true }

actions contains { "id": "school.finance.document.templates.read", "key": "READ_FINANCE_DOCUMENT_TEMPLATES", "resourceKind": "school" } if { true }
actions contains { "id": "school.finance.document.templates.manage", "key": "MANAGE_FINANCE_DOCUMENT_TEMPLATES", "resourceKind": "school" } if { true }
actions contains { "id": "school.finance.document.generate", "key": "GENERATE_FINANCE_DOCUMENTS", "resourceKind": "school" } if { true }
actions contains { "id": "school.finance.document.artifacts.read", "key": "READ_FINANCE_DOCUMENT_ARTIFACTS", "resourceKind": "school" } if { true }
actions contains { "id": "school.finance.document.artifacts.delete", "key": "DELETE_FINANCE_DOCUMENT_ARTIFACTS", "resourceKind": "school" } if { true }

actions contains {
  "id": "school.class.list",
  "key": "LIST_CLASSES",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.class.read",
  "key": "READ_CLASS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.class.create",
  "key": "CREATE_CLASS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.class.update",
  "key": "UPDATE_CLASS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.class.reorder",
  "key": "REORDER_CLASSES",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.class.configuration.update",
  "key": "UPDATE_CLASS_CONFIGURATION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.class.delete",
  "key": "DELETE_CLASS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.section.list",
  "key": "LIST_SECTIONS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.section.read",
  "key": "READ_SECTION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.section.create",
  "key": "CREATE_SECTION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.section.update",
  "key": "UPDATE_SECTION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.section.reorder",
  "key": "REORDER_SECTIONS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.section.attributes.update",
  "key": "UPDATE_SECTION_ATTRIBUTES",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.section.delete",
  "key": "DELETE_SECTION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.settings.read",
  "key": "READ_ADMISSION_SETTINGS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.settings.update",
  "key": "UPDATE_ADMISSION_SETTINGS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.list",
  "key": "LIST_ADMISSIONS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.read",
  "key": "READ_ADMISSION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.create",
  "key": "CREATE_ADMISSION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.update",
  "key": "UPDATE_ADMISSION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.unregister",
  "key": "UNREGISTER_ADMISSION",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.admission.delete",
  "key": "DELETE_ADMISSION",
  "resourceKind": "school",
} if { true }

# Issuing a Cadet Portal password (first password or any later reset). Its own
# action, so granting admission creation to another role never silently grants
# password issuing.
actions contains {
  "id": "school.admission.cadet_password.issue",
  "key": "ISSUE_ADMISSION_CADET_PASSWORD",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.student.list",
  "key": "LIST_STUDENTS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.student.read",
  "key": "READ_STUDENT",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.student.create",
  "key": "CREATE_STUDENT",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.student.update",
  "key": "UPDATE_STUDENT",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.student.class.remove",
  "key": "REMOVE_STUDENT_FROM_CLASS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.student.delete",
  "key": "DELETE_STUDENT",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.read",
  "key": "READ_EXAMS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.create",
  "key": "CREATE_EXAM",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.update",
  "key": "UPDATE_EXAM",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.delete",
  "key": "DELETE_EXAM",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.plan.read",
  "key": "READ_EXAM_PLANS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.plan.create",
  "key": "CREATE_EXAM_PLAN",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.plan.update",
  "key": "UPDATE_EXAM_PLAN",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.plan.delete",
  "key": "DELETE_EXAM_PLAN",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.plan.transition",
  "key": "TRANSITION_EXAM_PLAN",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.result.read",
  "key": "READ_EXAM_RESULTS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.result.revise",
  "key": "REVISE_EXAM_RESULTS",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.timetable.read",
  "key": "READ_EXAM_TIMETABLE",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.timetable.update",
  "key": "UPDATE_EXAM_TIMETABLE",
  "resourceKind": "school",
} if { true }

actions contains {
  "id": "school.exam.timetable.delete",
  "key": "DELETE_EXAM_TIMETABLE",
  "resourceKind": "school",
} if { true }

# Publishing a timetable shows it to the whole school (and, with the Cadet
# Portal, to students) and withdrawing hides it again; editing a draft is
# school.exam.timetable.update.
actions contains {
  "id": "school.exam.timetable.publish",
  "key": "PUBLISH_EXAM_TIMETABLE",
  "resourceKind": "school",
} if { true }

actions contains {"id": "school.exam.result.write", "key": "WRITE_EXAM_RESULTS", "resourceKind": "school"} if { true }
actions contains {"id": "school.exam.result.delete", "key": "DELETE_EXAM_RESULTS", "resourceKind": "school"} if { true }

actions contains {"id": "school.document.templates.read", "key": "READ_DOCUMENT_TEMPLATES", "resourceKind": "school"} if { true }

actions contains {"id": "school.document.templates.manage", "key": "MANAGE_DOCUMENT_TEMPLATES", "resourceKind": "school"} if { true }

actions contains {"id": "school.document.generate", "key": "GENERATE_DOCUMENTS", "resourceKind": "school"} if { true }

actions contains {"id": "school.document.artifacts.read", "key": "READ_DOCUMENT_ARTIFACTS", "resourceKind": "school"} if { true }

actions contains {"id": "school.document.artifacts.delete", "key": "DELETE_DOCUMENT_ARTIFACTS", "resourceKind": "school"} if { true }

# Notifications. Resending a failed delivery (delivery log) is school-wide.
# An examination's students are notified by its first Cadet release, which
# needs only the release permission (D-43); sending one student's result is
# class-scoped (class/catalog.rego) so teacher assignments can restrict it.
actions contains {"id": "school.notification.send", "key": "SEND_NOTIFICATIONS", "resourceKind": "school"} if { true }

# Notifications (Phase 7): the staff delivery log (per-channel status and
# skip/failure reasons, never message content). Resending a failed delivery
# uses school.notification.send.
actions contains {"id": "school.notification.log.read", "key": "READ_NOTIFICATION_LOG", "resourceKind": "school"} if { true }
# Who is told about failed WhatsApp deliveries (D-38), by topic: finance
# messages (bills, receipts) and result messages are separate actions, so
# each topic's audience is its own grant.
actions contains {"id": "school.notification.failure.finance.receive", "key": "RECEIVE_FINANCE_NOTIFICATION_FAILURES", "resourceKind": "school"} if { true }
actions contains {"id": "school.notification.failure.results.receive", "key": "RECEIVE_RESULT_NOTIFICATION_FAILURES", "resourceKind": "school"} if { true }
actions contains {"id": "school.notification.failure.notices.receive", "key": "RECEIVE_NOTICE_NOTIFICATION_FAILURES", "resourceKind": "school"} if { true }

# School notices (docs/notices.md). Reading covers every published notice and
# the caller's own drafts; drafting covers creating notices and editing or
# deleting one's own drafts (ownership is a data fact checked by the API,
# not a role); publishing also covers every draft of the school.
actions contains {"id": "school.notice.read", "key": "READ_NOTICE", "resourceKind": "school"} if { true }
actions contains {"id": "school.notice.draft", "key": "DRAFT_NOTICE", "resourceKind": "school"} if { true }
actions contains {"id": "school.notice.publish", "key": "PUBLISH_NOTICE", "resourceKind": "school"} if { true }
