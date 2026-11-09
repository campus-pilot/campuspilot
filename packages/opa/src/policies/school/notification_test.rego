package campuspilot.authorization.school_notification_test

import rego.v1

import data.campuspilot.authorization

school_input(action, role, school_id) := {
  "action": action,
  "subject": {"userId": "u1", "roleAssignments": [{"role": role, "scope": {"kind": "school", "schoolId": school_id}, "meta": null}]},
  "resource": {"kind": "school", "schoolId": "school-1"},
}

test_result_publication_roles if {
  every role in {"school.principal", "school.manager", "school.exam_coordinator", "school.accountant"} {
    authorization.allow with input as school_input("school.notification.send", role, "school-1")
    not authorization.allow with input as school_input("school.notification.send", role, "school-2")
  }
  not authorization.allow with input as school_input("school.notification.send", "school.teacher", "school-1")
  not authorization.allow with input as {
    "action": "school.notification.send",
    "subject": {"userId": "admin", "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}]},
    "resource": {"kind": "school", "schoolId": "school-1"},
  }
}

test_result_send_is_not_a_school_action if {
  not authorization.allow with input as school_input("class.notification.result.send", "school.principal", "school-1")
}

test_delivery_log_roles if {
  every role in {"school.principal", "school.manager", "school.exam_coordinator", "school.accountant"} {
    authorization.allow with input as school_input("school.notification.log.read", role, "school-1")
    not authorization.allow with input as school_input("school.notification.log.read", role, "school-2")
  }
  not authorization.allow with input as school_input("school.notification.log.read", "school.teacher", "school-1")
}

test_finance_failure_alerts_go_to_principal_manager_and_accountants if {
  every role in {"school.principal", "school.manager", "school.accountant"} {
    authorization.allow with input as school_input("school.notification.failure.finance.receive", role, "school-1")
    not authorization.allow with input as school_input("school.notification.failure.finance.receive", role, "school-2")
  }
  every role in {"school.exam_coordinator", "school.teacher"} {
    not authorization.allow with input as school_input("school.notification.failure.finance.receive", role, "school-1")
  }
}

test_result_failure_alerts_never_go_to_accountants if {
  every role in {"school.principal", "school.manager"} {
    authorization.allow with input as school_input("school.notification.failure.results.receive", role, "school-1")
    not authorization.allow with input as school_input("school.notification.failure.results.receive", role, "school-2")
  }
  every role in {"school.accountant", "school.exam_coordinator", "school.teacher"} {
    not authorization.allow with input as school_input("school.notification.failure.results.receive", role, "school-1")
  }
}

test_old_failure_action_is_gone if {
  not authorization.allow with input as school_input("school.notification.failure.receive", "school.accountant", "school-1")
}
