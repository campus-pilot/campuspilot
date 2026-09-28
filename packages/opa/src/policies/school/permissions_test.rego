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

test_school_details_and_logo_read_are_allowed_for_every_school_role if {
  every role in {"school.principal", "school.manager", "school.teacher", "school.accountant", "school.exam_coordinator"} {
    every action in {"school.details.read", "school.logo.read"} {
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

test_school_details_and_logo_update_are_allowed_for_principals_and_managers if {
  every role in {"school.principal", "school.manager"} {
    every action in {"school.details.update", "school.logo.update"} {
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

test_school_details_and_logo_update_are_denied_for_teacher if {
  every action in {"school.details.update", "school.logo.update"} {
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

test_logo_read_from_another_school_is_denied if {
  not authorization.allow with input as {
    "action": "school.logo.read",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [
        {"role": "school.principal", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
      ],
    },
    "resource": {"kind": "school", "schoolId": "school-2"},
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

test_member_read_is_allowed_for_every_school_role if {
  every role in {"school.principal", "school.manager", "school.teacher", "school.accountant", "school.exam_coordinator"} {
    every action in {"school.member.list", "school.member.read"} {
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

test_member_mutations_are_denied_for_ungranted_school_roles if {
  every action in {
    "school.member.invite",
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

test_session_mutations_are_allowed_for_principals_and_managers if {
  every role in {"school.principal", "school.manager"} {
    every action in {
      "school.session.create",
      "school.session.update",
      "school.session.delete",
      "school.session.activate",
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

test_session_read_is_allowed_for_every_school_role if {
  every role in {"school.principal", "school.manager", "school.teacher", "school.accountant", "school.exam_coordinator"} {
    every action in {"school.session.list", "school.session.read"} {
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

test_session_activation_is_allowed_for_principals_and_managers if {
  every role in {"school.principal", "school.manager"} {
    authorization.allow with input as {
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

test_admission_and_student_reads_are_explicitly_allowed_for_current_school_roles if {
  every role in {"school.principal", "school.manager", "school.teacher", "school.accountant", "school.exam_coordinator"} {
    every action in {
      "school.admission.settings.read",
      "school.admission.list",
      "school.admission.read",
      "school.student.list",
      "school.student.read",
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

test_admission_and_student_mutations_are_allowed_for_principals_and_managers if {
  every role in {"school.principal", "school.manager"} {
    every action in {
      "school.admission.settings.update",
      "school.admission.create",
      "school.admission.update",
      "school.admission.unregister",
      "school.admission.delete",
      "school.student.create",
      "school.student.update",
      "school.student.class.remove",
      "school.student.delete",
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

test_admission_and_student_mutations_are_denied_for_other_school_roles if {
  every role in {"school.teacher", "school.accountant", "school.exam_coordinator"} {
    every action in {
      "school.admission.settings.update",
      "school.admission.create",
      "school.admission.update",
      "school.admission.unregister",
      "school.admission.delete",
      "school.student.create",
      "school.student.update",
      "school.student.class.remove",
      "school.student.delete",
    } {
      not authorization.allow with input as {
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

test_platform_admin_can_govern_admission_settings_only if {
  every action in {
    "school.admission.settings.read",
    "school.admission.settings.update",
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

  every action in {
    "school.admission.create",
    "school.admission.update",
    "school.admission.unregister",
    "school.admission.delete",
  } {
    not authorization.allow with input as {
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

test_session_mutations_are_denied_for_ungranted_school_roles if {
  every action in {
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

test_session_finance_is_allowed_for_finance_roles if {
  every role in {"school.principal", "school.manager", "school.accountant"} {
    every action in {"school.session.finance.read", "school.session.finance.update"} {
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

test_session_finance_is_denied_for_non_finance_school_roles if {
  every role in {"school.teacher", "school.exam_coordinator"} {
    every action in {"school.session.finance.read", "school.session.finance.update"} {
      not authorization.allow with input as {
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

test_class_and_section_management_is_allowed_for_principals_and_managers if {
  every role in {"school.principal", "school.manager"} {
    every action in {
      "school.class.create",
      "school.class.delete",
      "school.class.reorder",
      "school.section.create",
      "school.section.delete",
      "school.section.reorder",
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

test_class_and_section_reads_and_edits_are_allowed_for_every_school_role if {
  every role in {"school.principal", "school.manager", "school.teacher", "school.accountant", "school.exam_coordinator"} {
    every action in {
      "school.class.list",
      "school.class.read",
      "school.class.update",
      "school.class.configuration.update",
      "school.section.list",
      "school.section.read",
      "school.section.update",
      "school.section.attributes.update",
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

test_class_and_section_management_is_denied_for_teacher if {
  every action in {
    "school.class.create",
    "school.class.delete",
    "school.class.reorder",
    "school.section.create",
    "school.section.delete",
    "school.section.reorder",
  } {
    not authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "teacher-1",
        "roleAssignments": [
          {"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": {"classIds": ["class-1"]}},
        ],
      },
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}

test_class_json_update_from_another_school_is_denied if {
  not authorization.allow with input as {
    "action": "school.class.configuration.update",
    "subject": {
      "userId": "teacher-1",
      "roleAssignments": [
        {"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
      ],
    },
    "resource": {"kind": "school", "schoolId": "school-2"},
  }
}
