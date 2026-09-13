package campuspilot.authorization.class_scope

import rego.v1

import data.campuspilot.authorization.common

role_permissions := {
  "teacher": {"class.student.add"},
}

allow if {
  common.valid_subject
  common.valid_class_resource
  some assignment in input.subject.roleAssignments
  role_permissions[assignment.role][input.action]
  is_object(assignment.meta)
  is_array(assignment.meta.classIds)
  input.resource.classId in assignment.meta.classIds
}
