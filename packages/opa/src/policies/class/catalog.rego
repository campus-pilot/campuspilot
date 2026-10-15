package campuspilot.authorization.catalog

import rego.v1

actions contains {
  "id": "class.student.add",
  "key": "ADD_STUDENT",
  "resourceKind": "class",
} if { true }

actions contains {"id": "class.exam.result.approve", "key": "APPROVE_EXAM_RESULTS", "resourceKind": "class"} if { true }
