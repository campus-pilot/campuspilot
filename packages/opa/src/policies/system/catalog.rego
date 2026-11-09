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

# Aggregate, platform-admin-only metrics. Counts never expose individual
# student records, so they are granted separately from school student actions.
actions contains {
  "id": "system.platform.stats.read",
  "key": "READ_PLATFORM_STATS",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.school.stats.read",
  "key": "READ_SCHOOL_STATS",
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

# Demo school provisioning and purge (docs/demo-school.md). Each operation has
# its own action so reading generated credentials or purging can be granted
# independently of creating a demo.
actions contains {
  "id": "system.school.demo.create",
  "key": "CREATE_DEMO_SCHOOL",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.school.demo.read",
  "key": "READ_DEMO_SCHOOL",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.school.demo.credentials.read",
  "key": "READ_DEMO_SCHOOL_CREDENTIALS",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.school.demo.purge",
  "key": "PURGE_DEMO_SCHOOL",
  "resourceKind": "system",
} if { true }

# Data migrations (packages/api/src/data-migrations): reading run status and
# skipped reports is separate from requesting a run, which changes data.
actions contains {
  "id": "system.data_migration.read",
  "key": "READ_DATA_MIGRATIONS",
  "resourceKind": "system",
} if { true }

actions contains {
  "id": "system.data_migration.run",
  "key": "RUN_DATA_MIGRATION",
  "resourceKind": "system",
} if { true }
