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
