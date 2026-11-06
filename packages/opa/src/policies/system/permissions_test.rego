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
    "school.session.finance.read",
    "school.session.finance.update",
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

test_admin_can_read_and_update_school_details if {
  every action in {
    "school.details.read",
    "school.details.update",
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

test_admin_cannot_manage_classes_or_sections_without_explicit_grants if {
  every action in {"school.class.create", "school.class.reorder", "school.section.create", "school.section.reorder"} {
    not authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "admin-1",
        "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}],
      },
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}

test_admin_can_manage_oauth_clients if {
  every action in {
    "system.oauth_client.list",
    "system.oauth_client.create",
    "system.oauth_client.update",
    "system.oauth_client.delete",
  } {
    authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "user-1",
        "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}],
      },
      "resource": {"kind": "system"},
    }
  }
}

test_regular_user_cannot_manage_oauth_clients if {
  not authorization.allow with input as {
    "action": "system.oauth_client.create",
    "subject": {
      "userId": "user-2",
      "roleAssignments": [{"role": "platform.user", "scope": {"kind": "platform"}}],
    },
    "resource": {"kind": "system"},
  }
}

test_school_principal_cannot_manage_oauth_clients if {
  not authorization.allow with input as {
    "action": "system.oauth_client.list",
    "subject": {
      "userId": "user-3",
      "roleAssignments": [{"role": "school.principal", "scope": {"kind": "school", "schoolId": "school-1"}}],
    },
    "resource": {"kind": "system"},
  }
}

test_admin_can_provision_read_and_purge_demo_schools if {
  every action in {
    "system.school.demo.create",
    "system.school.demo.read",
    "system.school.demo.credentials.read",
    "system.school.demo.purge",
  } {
    authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "admin-1",
        "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}],
      },
      "resource": {"kind": "system"},
    }
  }
}

test_regular_user_cannot_use_demo_school_actions if {
  every action in {
    "system.school.demo.create",
    "system.school.demo.read",
    "system.school.demo.credentials.read",
    "system.school.demo.purge",
  } {
    not authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "user-2",
        "roleAssignments": [{"role": "platform.user", "scope": {"kind": "platform"}}],
      },
      "resource": {"kind": "system"},
    }
  }
}

test_demo_principal_cannot_read_demo_credentials_or_purge if {
  every action in {"system.school.demo.credentials.read", "system.school.demo.purge"} {
    not authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "user-3",
        "roleAssignments": [{"role": "school.principal", "scope": {"kind": "school", "schoolId": "school-1"}}],
      },
      "resource": {"kind": "system"},
    }
  }
}

test_demo_actions_reject_school_resources if {
  not authorization.allow with input as {
    "action": "system.school.demo.purge",
    "subject": {
      "userId": "admin-1",
      "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}],
    },
    "resource": {"kind": "school", "schoolId": "school-1"},
  }
}

test_admin_can_read_aggregate_stats if {
  every action in {"system.platform.stats.read", "system.school.stats.read"} {
    authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "user-1",
        "roleAssignments": [{"role": "platform.admin", "scope": {"kind": "platform"}}],
      },
      "resource": {"kind": "system"},
    }
  }
}

test_school_principal_cannot_read_aggregate_stats if {
  every action in {"system.platform.stats.read", "system.school.stats.read"} {
    not authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "user-1",
        "roleAssignments": [{
          "role": "school.principal",
          "scope": {"kind": "school", "schoolId": "school-1"},
          "meta": {},
        }],
      },
      "resource": {"kind": "system"},
    }
  }
}
