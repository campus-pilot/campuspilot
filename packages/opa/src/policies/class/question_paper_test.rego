package campuspilot.authorization.class_question_paper_test
import rego.v1
import data.campuspilot.authorization

actions := {"class.exam.question_paper.read", "class.exam.question_paper.manage"}

paper_input(action, role, scope, meta) := {
 "action": action,
 "subject": {"userId": "u1", "roleAssignments": [{"role": role, "scope": scope, "meta": meta}]},
 "resource": {"kind": "class", "schoolId": "school-1", "classId": "class-1"},
}

school_scope(id) := {"kind": "school", "schoolId": id}

test_assigned_teacher_can_read_and_manage if {
 every action in actions {
  authorization.allow with input as paper_input(action, "school.teacher", school_scope("school-1"), {"classIds": ["class-1"]})
 }
}

test_unassigned_teacher_is_denied if {
 every action in actions {
  every meta in {null, {}, {"classIds": null}, {"classIds": []}, {"classIds": ["class-2"]}, {"classIds": "class-1"}} {
   not authorization.allow with input as paper_input(action, "school.teacher", school_scope("school-1"), meta)
  }
 }
}

test_school_admins_are_allowed_without_class_metadata if {
 every action in actions {
  every role in {"school.principal", "school.manager", "school.exam_coordinator"} {
   authorization.allow with input as paper_input(action, role, school_scope("school-1"), null)
  }
 }
}

test_other_school_scope_is_denied if {
 every action in actions {
  every role in {"school.principal", "school.manager", "school.exam_coordinator", "school.teacher"} {
   not authorization.allow with input as paper_input(action, role, school_scope("school-2"), {"classIds": ["class-1"]})
  }
 }
}

test_accountant_and_platform_roles_are_denied if {
 every action in actions {
  not authorization.allow with input as paper_input(action, "school.accountant", school_scope("school-1"), {"classIds": ["class-1"]})
  not authorization.allow with input as paper_input(action, "platform.admin", {"kind": "platform"}, null)
 }
}

test_wrong_resource_kind_and_missing_subject_are_denied if {
 not authorization.allow with input as {"action": "class.exam.question_paper.manage", "resource": {"kind": "class", "schoolId": "school-1", "classId": "class-1"}}
 not authorization.allow with input as object.union(
  paper_input("class.exam.question_paper.manage", "school.manager", school_scope("school-1"), null),
  {"resource": {"kind": "school", "schoolId": "school-1"}},
 )
}
