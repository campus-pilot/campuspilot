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
    "school.logo.update",
    "school.details.update",
    "school.member.roles.update",
    "school.member.remove",
    "school.session.create",
    "school.session.update",
    "school.session.delete",
    "school.session.activate",
    "school.class.create",
    "school.class.update",
    "school.class.delete",
    "school.section.create",
    "school.section.update",
    "school.section.delete",
  }
}

grants contains {
  "role": role,
  "action": action,
} if {
  some role in {
    "school.principal",
    "school.manager",
    "school.teacher",
    "school.accountant",
    "school.exam_coordinator",
  }
  some action in {
    "school.details.read",
    "school.logo.read",
    "school.member.list",
    "school.member.read",
    "school.session.list",
    "school.session.read",
    "school.class.list",
    "school.class.read",
    "school.class.configuration.update",
    "school.section.list",
    "school.section.read",
    "school.section.attributes.update",
  }
}

grants contains {
  "role": role,
  "action": action,
} if {
  some role in {
    "school.principal",
    "school.manager",
    "school.accountant",
  }
  some action in {
    "school.session.finance.read",
    "school.session.finance.update",
  }
}
