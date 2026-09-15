package campuspilot.authorization.catalog

import rego.v1

actions contains {
  "id": "system.school.list",
  "key": "LIST_SCHOOLS",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.school.read",
  "key": "READ_SCHOOL",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.school.create",
  "key": "CREATE_SCHOOL",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.school.update",
  "key": "UPDATE_SCHOOL",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.school.delete",
  "key": "DELETE_SCHOOL",
  "resourceKind": "system",
} if { true }
