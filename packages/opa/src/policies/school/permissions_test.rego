package campuspilot.authorization.school_test

import rego.v1

import data.campuspilot.authorization

test_any_matching_role_assignment_can_grant_access if {
  authorization.allow with input as {
    "action": "school.member.invite",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [
        {"role": "school.exam_coordinator", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
        {"role": "school.principal", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
      ],
    },
    "resource": {"kind": "school", "schoolId": "school-1"},
  }
}

test_roles_without_the_action_are_denied if {
  not authorization.allow with input as {
    "action": "school.member.invite",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [
        {"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": {"classIds": ["class-1"]}},
        {"role": "school.exam_coordinator", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
      ],
    },
    "resource": {"kind": "school", "schoolId": "school-1"},
  }
}

test_role_assignment_from_another_school_is_denied if {
  not authorization.allow with input as {
    "action": "school.member.invite",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [
        {"role": "school.principal", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
      ],
    },
    "resource": {"kind": "school", "schoolId": "school-2"},
  }
}

test_missing_user_id_is_denied if {
  not authorization.allow with input as {
    "action": "school.member.invite",
    "subject": {
      "userId": "",
      "roleAssignments": [],
    },
    "resource": {"kind": "school", "schoolId": "school-1"},
  }
}

test_member_crud_is_allowed_for_principals_and_managers if {
  every role in {"school.principal", "school.manager"} {
    every action in {
      "school.member.invite",
      "school.member.list",
      "school.member.read",
      "school.member.roles.update",
      "school.member.remove",
    } {
      authorization.allow with input as {
        "action": action,
        "subject": {
          "userId": "user-1",
          "roleAssignments": [
            {"role": role, "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
          ],
        },
        "resource": {"kind": "school", "schoolId": "school-1"},
      }
    }
  }
}

test_member_crud_is_allowed_for_platform_admin if {
  every action in {
    "school.member.invite",
    "school.member.list",
    "school.member.read",
    "school.member.roles.update",
    "school.member.remove",
  } {
    authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "admin-1",
        "roleAssignments": [
          {"role": "platform.admin", "scope": {"kind": "platform"}},
        ],
      },
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}

test_member_crud_is_denied_for_ungranted_school_roles if {
  every action in {
    "school.member.list",
    "school.member.read",
    "school.member.roles.update",
    "school.member.remove",
  } {
    not authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "user-1",
        "roleAssignments": [
          {"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": {"classIds": ["class-1"]}},
        ],
      },
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}

test_session_crud_is_allowed_for_principals_and_managers if {
  every role in {"school.principal", "school.manager"} {
    every action in {
      "school.session.list",
      "school.session.read",
      "school.session.create",
      "school.session.update",
      "school.session.delete",
    } {
      authorization.allow with input as {
        "action": action,
        "subject": {
          "userId": "user-1",
          "roleAssignments": [
            {"role": role, "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
          ],
        },
        "resource": {"kind": "school", "schoolId": "school-1"},
      }
    }
  }
}

test_session_activation_is_denied_for_principals_and_managers if {
  every role in {"school.principal", "school.manager"} {
    not authorization.allow with input as {
      "action": "school.session.activate",
      "subject": {
        "userId": "user-1",
        "roleAssignments": [
          {"role": role, "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
        ],
      },
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}

test_session_crud_is_denied_for_ungranted_school_roles if {
  every action in {
    "school.session.list",
    "school.session.read",
    "school.session.create",
    "school.session.update",
    "school.session.delete",
    "school.session.activate",
  } {
    not authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "user-1",
        "roleAssignments": [
          {"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": {"classIds": ["class-1"]}},
        ],
      },
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}
