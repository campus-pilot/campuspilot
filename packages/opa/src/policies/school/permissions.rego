package campuspilot.authorization.school

import rego.v1

import data.campuspilot.authorization.common

role_permissions := {
  "principal": {"school.member.invite"},
  "manager": {"school.member.invite"},
}

allow if {
  common.valid_subject
  common.valid_school_resource
  some assignment in input.subject.roleAssignments
  role_permissions[assignment.role][input.action]
}
