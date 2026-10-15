package campuspilot.authorization.school_exam_test
import rego.v1
import data.campuspilot.authorization
school_input(action, role, school_id) := {
 "action": action,
 "subject": {"userId": "u1", "roleAssignments": [{"role": role, "scope": {"kind": "school", "schoolId": school_id}, "meta": null}]},
 "resource": {"kind": "school", "schoolId": "school-1"},
}
test_all_staff_can_view_exams if {
 every role in {"school.teacher", "school.accountant", "school.principal", "school.manager", "school.exam_coordinator"} {
  every action in {"school.exam.read", "school.exam.plan.read", "school.exam.result.read", "school.exam.timetable.read"} {
   authorization.allow with input as school_input(action, role, "school-1")
  }
 }
}
test_governance_is_school_admin_only if {
 every action in {"school.exam.create", "school.exam.update", "school.exam.delete", "school.exam.plan.create", "school.exam.plan.update", "school.exam.plan.delete", "school.exam.plan.transition", "school.exam.timetable.update", "school.exam.timetable.delete", "school.exam.result.revise"} {
  every role in {"school.principal", "school.manager", "school.exam_coordinator"} {
   authorization.allow with input as school_input(action, role, "school-1")
   not authorization.allow with input as school_input(action, role, "school-2")
  }
  every role in {"school.teacher", "school.accountant"} {
   not authorization.allow with input as school_input(action, role, "school-1")
  }
  not authorization.allow with input as {
   "action": action, "subject": {"userId": "admin", "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}]},
   "resource": {"kind": "school", "schoolId": "school-1"},
  }
 }
}
test_platform_admin_has_read_grants_only if {
 every action in {"school.exam.read", "school.exam.plan.read", "school.exam.result.read", "school.exam.timetable.read"} {
  authorization.allow with input as {"action": action, "subject": {"userId": "admin", "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}]}, "resource": {"kind": "school", "schoolId": "school-1"}}
 }
}
test_any_teacher_can_enter_results if {
 authorization.allow with input as school_input("school.exam.result.write", "school.teacher", "school-1")
 not authorization.allow with input as school_input("school.exam.result.write", "school.teacher", "school-2")
 not authorization.allow with input as school_input("school.exam.result.write", "school.accountant", "school-1")
}
test_missing_subject_wrong_kind_unknown_action_denied if {
 not authorization.allow with input as {"action": "school.exam.create", "resource": {"kind": "school", "schoolId": "school-1"}}
 not authorization.allow with input as object.union(school_input("school.exam.create", "school.manager", "school-1"), {"resource": {"kind": "class", "schoolId": "school-1", "classId": "c1"}})
 not authorization.allow with input as school_input("school.exam.unknown", "school.manager", "school-1")
}
