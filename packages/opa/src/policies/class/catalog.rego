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

# Question papers (handlebar-based-question-paper-generation, D18/D37). Class
# scoped because a teacher may only work on papers of the classes assigned to
# them (meta.classIds). `manage` = upload/reorder/delete pages, delete a paper,
# start generation, save a version. `read` = list, view, preview, download.
actions contains {"id": "class.exam.question_paper.read", "key": "READ_EXAM_QUESTION_PAPERS", "resourceKind": "class"} if { true }
actions contains {"id": "class.exam.question_paper.manage", "key": "MANAGE_EXAM_QUESTION_PAPERS", "resourceKind": "class"} if { true }
