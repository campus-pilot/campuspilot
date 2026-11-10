package campuspilot.authorization.school_notice_test

import rego.v1

import data.campuspilot.authorization

school_input(action, role, school_id) := {
  "action": action,
  "subject": {"userId": "u1", "roleAssignments": [{"role": role, "scope": {"kind": "school", "schoolId": school_id}, "meta": null}]},
  "resource": {"kind": "school", "schoolId": "school-1"},
}

platform_admin_input(action) := {
  "action": action,
  "subject": {"userId": "admin", "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}]},
  "resource": {"kind": "school", "schoolId": "school-1"},
}

all_roles := {"school.principal", "school.manager", "school.teacher", "school.accountant", "school.exam_coordinator"}

test_every_staff_role_reads_and_drafts_notices_in_its_own_school if {
  every role in all_roles {
    every action in {"school.notice.read", "school.notice.draft"} {
      authorization.allow with input as school_input(action, role, "school-1")
      not authorization.allow with input as school_input(action, role, "school-2")
    }
  }
}

test_only_principal_and_manager_publish_notices if {
  every role in {"school.principal", "school.manager"} {
    authorization.allow with input as school_input("school.notice.publish", role, "school-1")
    not authorization.allow with input as school_input("school.notice.publish", role, "school-2")
  }
  every role in {"school.teacher", "school.accountant", "school.exam_coordinator"} {
    not authorization.allow with input as school_input("school.notice.publish", role, "school-1")
  }
}

test_platform_admin_has_no_notice_access if {
  every action in {"school.notice.read", "school.notice.draft", "school.notice.publish", "school.notification.failure.notices.receive"} {
    not authorization.allow with input as platform_admin_input(action)
  }
}

test_notice_actions_are_not_class_actions if {
  not authorization.allow with input as {
    "action": "school.notice.publish",
    "subject": {"userId": "u1", "roleAssignments": [{"role": "school.principal", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null}]},
    "resource": {"kind": "class", "schoolId": "school-1", "classId": "class-1"},
  }
}

test_notice_failure_alerts_go_to_principal_and_manager if {
  every role in {"school.principal", "school.manager"} {
    authorization.allow with input as school_input("school.notification.failure.notices.receive", role, "school-1")
    not authorization.allow with input as school_input("school.notification.failure.notices.receive", role, "school-2")
  }
  every role in {"school.accountant", "school.exam_coordinator", "school.teacher"} {
    not authorization.allow with input as school_input("school.notification.failure.notices.receive", role, "school-1")
  }
}
