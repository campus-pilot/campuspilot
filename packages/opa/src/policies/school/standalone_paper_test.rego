package campuspilot.authorization.school_standalone_paper_test

import rego.v1

import data.campuspilot.authorization

school_input(action, role, school_id) := {
  "action": action,
  "subject": {"userId": "u1", "roleAssignments": [{"role": role, "scope": {"kind": "school", "schoolId": school_id}, "meta": null}]},
  "resource": {"kind": "school", "schoolId": "school-1"},
}

standalone_paper_actions := {"school.standalone_paper.read", "school.standalone_paper.manage"}

test_principal_reads_and_manages_standalone_papers_in_their_own_school if {
  every action in standalone_paper_actions {
    authorization.allow with input as school_input(action, "school.principal", "school-1")
    not authorization.allow with input as school_input(action, "school.principal", "school-2")
  }
}

test_other_roles_have_no_standalone_paper_actions if {
  every role in {"school.manager", "school.teacher", "school.accountant", "school.exam_coordinator"} {
    every action in standalone_paper_actions {
      not authorization.allow with input as school_input(action, role, "school-1")
    }
  }
}

test_platform_admin_has_no_standalone_paper_actions if {
  every action in standalone_paper_actions {
    not authorization.allow with input as {
      "action": action,
      "subject": {"userId": "admin", "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}]},
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}

test_standalone_paper_actions_are_not_class_actions if {
  not authorization.allow with input as {
    "action": "school.standalone_paper.read",
    "subject": {"userId": "u1", "roleAssignments": [{"role": "school.principal", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null}]},
    "resource": {"kind": "class", "schoolId": "school-1", "classId": "class-1"},
  }
}
