package campuspilot.authorization.school

import rego.v1

import data.campuspilot.authorization.catalog
import data.campuspilot.authorization.common

allow if {
  common.valid_subject
  common.valid_school_resource
  catalog.action_targets_resource(input.action, input.resource.kind)
  some assignment in input.subject.roleAssignments
  assignment.scope.kind == "school"
  assignment.scope.schoolId == input.resource.schoolId
  catalog.role_has_action(assignment.role, input.action)
}
