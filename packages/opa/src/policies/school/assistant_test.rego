package campuspilot.authorization.school_assistant_test

import rego.v1

import data.campuspilot.authorization

school_input(action, role, school_id) := {
  "action": action,
  "subject": {"userId": "u1", "roleAssignments": [{"role": role, "scope": {"kind": "school", "schoolId": school_id}, "meta": null}]},
  "resource": {"kind": "school", "schoolId": "school-1"},
}

assistant_actions := {"school.assistant.access.read", "school.assistant.access.manage", "school.assistant.usage.read"}

test_principal_and_manager_manage_assistant_access_and_read_usage_in_their_own_school if {
  every role in {"school.principal", "school.manager"} {
    every action in assistant_actions {
      authorization.allow with input as school_input(action, role, "school-1")
      not authorization.allow with input as school_input(action, role, "school-2")
    }
  }
}

test_other_roles_cannot_see_or_manage_assistant_access_or_usage if {
  every role in {"school.teacher", "school.accountant", "school.exam_coordinator"} {
    every action in assistant_actions {
      not authorization.allow with input as school_input(action, role, "school-1")
    }
  }
}

test_using_the_assistant_is_no_grant if {
  every role in {"school.principal", "school.manager", "school.teacher", "school.accountant", "school.exam_coordinator"} {
    not authorization.allow with input as school_input("school.assistant.use", role, "school-1")
  }
}

test_platform_admin_has_no_school_assistant_actions if {
  every action in assistant_actions {
    not authorization.allow with input as {
      "action": action,
      "subject": {"userId": "admin", "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}]},
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}

test_assistant_actions_are_not_class_actions if {
  not authorization.allow with input as {
    "action": "school.assistant.access.manage",
    "subject": {"userId": "u1", "roleAssignments": [{"role": "school.principal", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null}]},
    "resource": {"kind": "class", "schoolId": "school-1", "classId": "class-1"},
  }
}

test_only_platform_admins_read_platform_assistant_usage if {
  authorization.allow with input as {
    "action": "system.assistant.usage.read",
    "subject": {"userId": "admin", "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}]},
    "resource": {"kind": "system"},
  }
  not authorization.allow with input as {
    "action": "system.assistant.usage.read",
    "subject": {"userId": "u2", "roleAssignments": [{"role": "platform.user", "scope": {"kind": "platform"}}]},
    "resource": {"kind": "system"},
  }
  not authorization.allow with input as {
    "action": "system.assistant.usage.read",
    "subject": {"userId": "u3", "roleAssignments": [{"role": "school.principal", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null}]},
    "resource": {"kind": "system"},
  }
}
