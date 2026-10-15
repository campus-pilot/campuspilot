package campuspilot.authorization.class_exam_test
import rego.v1
import data.campuspilot.authorization
approval_input(role, scope, meta) := {
 "action": "class.exam.result.approve",
 "subject": {"userId": "u1", "roleAssignments": [{"role": role, "scope": scope, "meta": meta}]},
 "resource": {"kind": "class", "schoolId": "school-1", "classId": "class-1"},
}
test_assigned_teacher_can_approve if {
 authorization.allow with input as approval_input("school.teacher", {"kind": "school", "schoolId": "school-1"}, {"classIds": ["class-1"]})
}
test_unassigned_teacher_cannot_approve if {
 every meta in {null, {}, {"classIds": null}, {"classIds": []}, {"classIds": ["class-2"]}, {"classIds": "class-1"}} {
  not authorization.allow with input as approval_input("school.teacher", {"kind": "school", "schoolId": "school-1"}, meta)
 }
}
test_school_admins_approve_without_class_metadata if {
 every role in {"school.principal", "school.manager", "school.exam_coordinator"} {
  authorization.allow with input as approval_input(role, {"kind": "school", "schoolId": "school-1"}, null)
  not authorization.allow with input as approval_input(role, {"kind": "school", "schoolId": "school-2"}, null)
 }
}
test_platform_admin_and_accountant_cannot_approve if {
 not authorization.allow with input as approval_input("platform.admin", {"kind": "platform"}, null)
 not authorization.allow with input as approval_input("school.accountant", {"kind": "school", "schoolId": "school-1"}, {"classIds": ["class-1"]})
}
test_class_approval_wrong_kind_and_missing_subject_denied if {
 not authorization.allow with input as {"action": "class.exam.result.approve", "resource": {"kind": "class", "schoolId": "school-1", "classId": "class-1"}}
 not authorization.allow with input as object.union(approval_input("school.teacher", {"kind": "school", "schoolId": "school-1"}, {"classIds": ["class-1"]}), {"resource": {"kind": "school", "schoolId": "school-1"}})
}
