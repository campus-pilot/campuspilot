package campuspilot.authorization.catalog

import rego.v1

grants contains {
  "role": "school.teacher",
  "action": "class.student.add",
} if { true }

grants contains {"role": role, "action": action} if {
  some role in {"school.principal", "school.manager", "school.exam_coordinator", "school.teacher"}
  some action in {"class.exam.result.approve"}
}

grants contains {"role": role, "action": "class.notification.result.send"} if {
  some role in {"school.principal", "school.manager", "school.exam_coordinator", "school.accountant", "school.teacher"}
}

# Question papers: the assigned teachers plus principal, manager and exam
# coordinator (D37). Accountants and platform roles are not granted.
grants contains {"role": role, "action": action} if {
  some role in {"school.principal", "school.manager", "school.exam_coordinator", "school.teacher"}
  some action in {"class.exam.question_paper.read", "class.exam.question_paper.manage"}
}
