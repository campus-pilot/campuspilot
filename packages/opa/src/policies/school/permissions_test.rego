package campuspilot.authorization.school_test

import rego.v1

import data.campuspilot.authorization

test_any_matching_role_assignment_can_grant_access if {
  authorization.allow with input as {
    "action": "school.member.invite",
    "subject": {
      "userId": "user-1",
      "systemRole": "user",
      "roleAssignments": [
        {"role": "exam_coordinator", "meta": null},
        {"role": "principal", "meta": null},
      ],
    },
    "resource": {"level": "school", "schoolId": "school-1"},
  }
}

test_roles_without_the_action_are_denied if {
  not authorization.allow with input as {
    "action": "school.member.invite",
    "subject": {
      "userId": "user-1",
      "systemRole": "user",
      "roleAssignments": [
        {"role": "teacher", "meta": {"classIds": ["class-1"]}},
        {"role": "exam_coordinator", "meta": null},
      ],
    },
    "resource": {"level": "school", "schoolId": "school-1"},
  }
}

test_missing_user_id_is_denied if {
  not authorization.allow with input as {
    "action": "school.member.invite",
    "subject": {
      "userId": "",
      "systemRole": "admin",
      "roleAssignments": [],
    },
    "resource": {"level": "school", "schoolId": "school-1"},
  }
}
