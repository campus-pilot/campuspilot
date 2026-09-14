package campuspilot.authorization.system

import rego.v1

import data.campuspilot.authorization.catalog
import data.campuspilot.authorization.common

valid_resource if {
  common.valid_system_resource
}

valid_resource if {
  common.valid_school_resource
}

allow if {
  common.valid_subject
  valid_resource
  catalog.action_targets_resource(input.action, input.resource.kind)
  some assignment in input.subject.roleAssignments
  assignment.scope.kind == "platform"
  catalog.role_has_action(assignment.role, input.action)
}
