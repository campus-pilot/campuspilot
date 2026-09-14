package campuspilot.authorization.class_scope

import rego.v1

import data.campuspilot.authorization.catalog
import data.campuspilot.authorization.common

allow if {
  common.valid_subject
  common.valid_class_resource
  catalog.action_targets_resource(input.action, input.resource.kind)
  some assignment in input.subject.roleAssignments
  assignment.scope.kind == "school"
  assignment.scope.schoolId == input.resource.schoolId
  catalog.role_has_action(assignment.role, input.action)
  is_object(assignment.meta)
  is_array(assignment.meta.classIds)
  input.resource.classId in assignment.meta.classIds
}
