package campuspilot.authorization.common

import rego.v1

valid_subject if {
  is_string(input.subject.userId)
  input.subject.userId != ""
  is_array(input.subject.roleAssignments)
}

valid_system_resource if {
  input.resource.level == "system"
}

valid_school_resource if {
  input.resource.level == "school"
  is_string(input.resource.schoolId)
  input.resource.schoolId != ""
}

valid_class_resource if {
  input.resource.level == "class"
  is_string(input.resource.schoolId)
  input.resource.schoolId != ""
  is_string(input.resource.classId)
  input.resource.classId != ""
}
