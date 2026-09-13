package campuspilot.authorization

import rego.v1

import data.campuspilot.authorization.class_scope
import data.campuspilot.authorization.school
import data.campuspilot.authorization.system

default allow := false

allow if {
  system.allow
}

allow if {
  school.allow
}

allow if {
  class_scope.allow
}

decision := {"allowed": allow}
