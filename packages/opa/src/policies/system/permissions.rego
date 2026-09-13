package campuspilot.authorization.system

import rego.v1

import data.campuspilot.authorization.common

# Global roles only receive the actions listed here. There is deliberately no
# system-role override or wildcard that bypasses school and class policies.
role_permissions := {
  "admin": {
    # System-level permissions
    "system.school.list",
    "system.school.read",
    "system.school.create",
    "system.school.update",
    "system.school.logo.update",
    "system.school.delete",
    # School-level permissions
    "school.member.invite",
  },
}

valid_resource if {
  common.valid_system_resource
}

valid_resource if {
  common.valid_school_resource
}

allow if {
  common.valid_subject
  valid_resource
  role_permissions[input.subject.systemRole][input.action]
}
