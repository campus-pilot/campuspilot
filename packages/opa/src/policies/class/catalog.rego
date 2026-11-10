package campuspilot.authorization.catalog

import rego.v1

actions contains {
  "id": "class.student.add",
  "key": "ADD_STUDENT",
  "resourceKind": "class",
} if { true }

actions contains {"id": "class.exam.result.approve", "key": "APPROVE_EXAM_RESULTS", "resourceKind": "class"} if { true }

# D-35: send one student's result to the student and guardian. Class-scoped
# because teachers may only send for their assigned classes (meta.classIds).
actions contains {"id": "class.notification.result.send", "key": "SEND_RESULT_NOTIFICATION", "resourceKind": "class"} if { true }
