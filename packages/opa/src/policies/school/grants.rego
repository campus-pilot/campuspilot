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
    "school.class.delete",
    "school.class.reorder",
    "school.section.create",
    "school.section.delete",
    "school.section.reorder",
    "school.admission.settings.update",
    "school.admission.create",
    "school.admission.update",
    "school.admission.unregister",
    "school.admission.delete",
    "school.student.create",
    "school.student.update",
    "school.student.class.remove",
    "school.student.delete",
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
    "school.class.update",
    "school.class.configuration.update",
    "school.section.list",
    "school.section.read",
    "school.section.update",
    "school.section.attributes.update",
    "school.admission.settings.read",
    "school.admission.list",
    "school.admission.read",
    "school.student.list",
    "school.student.read",
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

grants contains {"role": role, "action": action} if {
  some role in {"school.principal", "school.manager", "school.teacher", "school.accountant", "school.exam_coordinator"}
  some action in {"school.exam.read", "school.exam.plan.read", "school.exam.result.read", "school.exam.timetable.read"}
}

grants contains {"role": role, "action": action} if {
  some role in {"school.principal", "school.manager", "school.exam_coordinator"}
  some action in {"school.exam.create", "school.exam.update", "school.exam.delete", "school.exam.plan.create", "school.exam.plan.update", "school.exam.plan.delete", "school.exam.plan.transition", "school.exam.result.revise", "school.exam.timetable.update", "school.exam.timetable.delete"}
}

grants contains {"role": role, "action": action} if {
  some role in {"school.principal", "school.manager", "school.exam_coordinator", "school.teacher"}
  some action in {"school.exam.result.write", "school.exam.result.delete"}
}


grants contains {"role": role, "action": action} if {
  some role in {"school.principal", "school.manager", "school.exam_coordinator", "school.teacher", "school.accountant"}
  some action in {"school.document.templates.read", "school.document.artifacts.read"}
}
grants contains {"role": role, "action": action} if {
  some role in {"school.principal", "school.manager", "school.exam_coordinator"}
  some action in {"school.document.templates.manage", "school.document.generate", "school.document.artifacts.delete"}
}
