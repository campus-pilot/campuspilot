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
  school_kind_allows(assignment, input.action)
}

# Actions that exist only in a personal space (docs/personal-space.md): a role
# that grants them grants them only where the assignment's school is of kind
# "personal". The kind is a fact of the assignment's school
# (`scope.schoolKind`, read with the role rows by the API's
# `checkPermissions`), never inferred; an assignment without it is not granted
# these actions. The API's school kind gate refuses the same calls first; this
# keeps the grant itself honest, so a real school's principal never holds them.
personal_space_actions := {
  "school.standalone_paper.read",
  "school.standalone_paper.manage",
}

personal_space_action(action) if action in personal_space_actions

school_kind_allows(_, action) if not personal_space_action(action)

school_kind_allows(assignment, action) if {
  personal_space_action(action)
  assignment.scope.schoolKind == "personal"
}
