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
