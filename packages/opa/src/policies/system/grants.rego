package campuspilot.authorization.catalog

import rego.v1

grants contains {
  "role": "platform.admin",
  "action": "system.school.list",
} if { true }

grants contains {
  "role": "platform.admin",
  "action": "system.school.read",
} if { true }

grants contains {
  "role": "platform.admin",
  "action": "system.school.create",
} if { true }

grants contains {
  "role": "platform.admin",
  "action": "system.school.update",
} if { true }

grants contains {
  "role": "platform.admin",
  "action": "system.school.logo.update",
} if { true }

grants contains {
  "role": "platform.admin",
  "action": "system.school.delete",
} if { true }

grants contains {
  "role": "platform.admin",
  "action": "school.member.invite",
} if { true }

grants contains {
  "role": "platform.admin",
  "action": action,
} if {
  some action in {
    "school.member.list",
    "school.member.read",
    "school.member.roles.update",
    "school.member.remove",
    "school.session.list",
    "school.session.read",
    "school.session.create",
    "school.session.update",
    "school.session.delete",
    "school.session.activate",
  }
}
