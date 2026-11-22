package campuspilot.authorization.school_standalone_paper_test

import rego.v1

import data.campuspilot.authorization

kind_input(action, role, school_id, school_kind) := {
  "action": action,
  "subject": {"userId": "u1", "roleAssignments": [{"role": role, "scope": {"kind": "school", "schoolId": school_id, "schoolKind": school_kind}, "meta": null}]},
  "resource": {"kind": "school", "schoolId": "school-1"},
}

own_paper_actions := {"school.standalone_paper.read", "school.standalone_paper.manage"}

writers := {"school.principal", "school.manager", "school.exam_coordinator", "school.teacher"}

overseers := {"school.principal", "school.manager", "school.exam_coordinator"}

test_writers_read_and_manage_their_standalone_papers_in_their_own_school if {
  every role in writers {
    every school_kind in {"school", "personal"} {
      every action in own_paper_actions {
        authorization.allow with input as kind_input(action, role, "school-1", school_kind)
        not authorization.allow with input as kind_input(action, role, "school-2", school_kind)
      }
    }
  }
}

test_the_accountant_has_no_standalone_paper_actions if {
  every action in own_paper_actions | {"school.standalone_paper.oversee"} {
    not authorization.allow with input as kind_input(action, "school.accountant", "school-1", "school")
  }
}

test_only_school_wide_roles_oversee_every_standalone_paper if {
  every role in overseers {
    authorization.allow with input as kind_input("school.standalone_paper.oversee", role, "school-1", "school")
    not authorization.allow with input as kind_input("school.standalone_paper.oversee", role, "school-2", "school")
  }
  not authorization.allow with input as kind_input("school.standalone_paper.oversee", "school.teacher", "school-1", "school")
}

test_an_assignment_without_its_school_kind_still_gets_standalone_paper_actions if {
  every action in own_paper_actions {
    authorization.allow with input as {
      "action": action,
      "subject": {"userId": "u1", "roleAssignments": [{"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null}]},
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}

test_platform_admin_has_no_standalone_paper_actions if {
  every action in own_paper_actions | {"school.standalone_paper.oversee"} {
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
    "subject": {"userId": "u1", "roleAssignments": [{"role": "school.principal", "scope": {"kind": "school", "schoolId": "school-1", "schoolKind": "school"}, "meta": null}]},
    "resource": {"kind": "class", "schoolId": "school-1", "classId": "class-1"},
  }
}

test_the_school_kind_changes_no_other_action if {
  every school_kind in {"school", "personal"} {
    authorization.allow with input as kind_input("school.details.read", "school.principal", "school-1", school_kind)
  }
}
