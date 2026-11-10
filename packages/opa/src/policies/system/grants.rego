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
  "action": "system.school.delete",
} if { true }

grants contains {"role": "platform.admin", "action": action} if {
  some action in {
    "system.platform.stats.read",
    "system.school.stats.read",
  }
}

grants contains {"role": "platform.admin", "action": action} if {
  some action in {
    "system.school.demo.create",
    "system.school.demo.read",
    "system.school.demo.credentials.read",
    "system.school.demo.purge",
  }
}

grants contains {"role": "platform.admin", "action": action} if {
  some action in {
    "system.data_migration.read",
    "system.data_migration.run",
  }
}

grants contains {"role": "platform.admin", "action": action} if {
  some action in {
    "system.school.feature_flags.read",
    "system.school.feature_flags.update",
  }
}

grants contains {
  "role": "platform.admin",
  "action": "system.oauth_client.list",
} if { true }

grants contains {
  "role": "platform.admin",
  "action": "system.oauth_client.create",
} if { true }

grants contains {
  "role": "platform.admin",
  "action": "system.oauth_client.update",
} if { true }

grants contains {
  "role": "platform.admin",
  "action": "system.oauth_client.delete",
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
    "school.details.read",
    "school.details.update",
    "school.logo.read",
    "school.logo.update",
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
    "school.session.finance.read",
    "school.session.finance.update",
    "school.admission.finance.read",
    "school.admission.finance.update",
    "school.billing.run.read",
    "school.billing.report.read",
    "school.admission.ledger.read",
    "school.finance.document.templates.read",
    "school.finance.document.artifacts.read",
    "school.admission.settings.read",
    "school.admission.settings.update",
  }
}

grants contains {"role": role, "action": action} if {
  some role in {"platform.admin"}
  some action in {"school.exam.read", "school.exam.plan.read", "school.exam.result.read", "school.exam.timetable.read"}
}

grants contains {"role": "platform.admin", "action": "system.assistant.usage.read"} if { true }
