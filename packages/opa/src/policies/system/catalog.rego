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

actions contains {
  "id": "system.oauth_client.list",
  "key": "LIST_OAUTH_CLIENTS",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.oauth_client.create",
  "key": "CREATE_OAUTH_CLIENT",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.oauth_client.update",
  "key": "UPDATE_OAUTH_CLIENT",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.oauth_client.delete",
  "key": "DELETE_OAUTH_CLIENT",
  "resourceKind": "system",
} if { true }
