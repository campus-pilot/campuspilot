package campuspilot.authorization.catalog

import rego.v1

grants contains {
  "role": "school.teacher",
  "action": "class.student.add",
} if { true }
