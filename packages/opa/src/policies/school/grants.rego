package campuspilot.authorization.catalog

import rego.v1

grants contains {
  "role": "school.principal",
  "action": "school.member.invite",
} if { true }

grants contains {
  "role": "school.manager",
  "action": "school.member.invite",
} if { true }

grants contains {
  "role": role,
  "action": action,
} if {
  some role in {"school.principal", "school.manager"}
  some action in {
    "school.member.list",
    "school.member.read",
    "school.member.roles.update",
    "school.member.remove",
  }
}
