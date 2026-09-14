package campuspilot.authorization.system_test

import rego.v1

import data.campuspilot.authorization

test_admin_can_use_an_explicit_system_action if {
  authorization.allow with input as {
    "action": "system.school.list",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}],
    },
    "resource": {"kind": "system"},
  }
}

test_admin_can_use_an_explicit_school_action if {
  authorization.allow with input as {
    "action": "school.member.invite",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}],
    },
    "resource": {"kind": "school", "schoolId": "school-1"},
  }
}

test_admin_cannot_use_an_unlisted_class_action if {
  not authorization.allow with input as {
    "action": "class.student.add",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}],
    },
    "resource": {
      "kind": "class",
      "schoolId": "school-1",
      "classId": "class-1",
    },
  }
}

test_unknown_action_is_denied if {
  not authorization.allow with input as {
    "action": "system.unknown",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}],
    },
    "resource": {"kind": "system"},
  }
}

test_admin_can_manage_and_activate_school_sessions if {
  every action in {
    "school.session.list",
    "school.session.read",
    "school.session.create",
    "school.session.update",
    "school.session.delete",
    "school.session.activate",
  } {
    authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "admin-1",
        "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}],
      },
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}
