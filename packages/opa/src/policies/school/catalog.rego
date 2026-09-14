package campuspilot.authorization.catalog

import rego.v1

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
