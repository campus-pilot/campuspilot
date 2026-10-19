package campuspilot.authorization.school_finance_test

import rego.v1

import data.campuspilot.authorization

finance_actions := {
  "school.session.finance.read",
  "school.session.finance.update",
  "school.admission.finance.read",
  "school.admission.finance.update",
  "school.billing.run.read",
  "school.billing.report.read",
  "school.admission.ledger.read",
}

finance_post_actions := {
  "school.billing.run.preview",
  "school.billing.run.post",
  "school.billing.bill.manual.create",
  "school.billing.bill.reverse",
  "school.billing.run.reverse",
}

test_finance_roles_have_configuration_and_read_boundaries if {
  every role in {"school.principal", "school.manager", "school.accountant"} {
    every action in finance_actions {
      authorization.allow with input as {
        "action": action,
        "subject": {
          "userId": "finance-user",
          "roleAssignments": [
            {"role": role, "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
          ],
        },
        "resource": {"kind": "school", "schoolId": "school-1"},
      }
    }
  }
}

test_non_finance_school_roles_are_denied if {
  every role in {"school.teacher", "school.exam_coordinator"} {
    every action in finance_actions {
      not authorization.allow with input as {
        "action": action,
        "subject": {
          "userId": "non-finance-user",
          "roleAssignments": [
            {"role": role, "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
          ],
        },
        "resource": {"kind": "school", "schoolId": "school-1"},
      }
    }
  }
}

test_finance_roles_have_full_billing_authority if {
  every role in {"school.principal", "school.manager", "school.accountant"} {
    every action in finance_post_actions {
      authorization.allow with input as {
        "action": action,
        "subject": {
          "userId": "finance-user",
          "roleAssignments": [
            {"role": role, "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
          ],
        },
        "resource": {"kind": "school", "schoolId": "school-1"},
      }
    }
  }
}

test_non_finance_roles_and_other_tenants_cannot_post_billing if {
  every action in finance_post_actions {
    every role in {"school.teacher", "school.exam_coordinator"} {
      not authorization.allow with input as {
        "action": action,
        "subject": {"userId": "u1", "roleAssignments": [{"role": role, "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null}]},
        "resource": {"kind": "school", "schoolId": "school-1"},
      }
    }
    not authorization.allow with input as {
      "action": action,
      "subject": {"userId": "u2", "roleAssignments": [{"role": "school.accountant", "scope": {"kind": "school", "schoolId": "school-2"}, "meta": null}]},
      "resource": {"kind": "school", "schoolId": "school-1"},
    }
  }
}

test_finance_school_roles_cannot_cross_tenant_scope if {
  every action in finance_actions {
    not authorization.allow with input as {
      "action": action,
      "subject": {
        "userId": "accountant-1",
        "roleAssignments": [
          {"role": "school.accountant", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
        ],
      },
      "resource": {"kind": "school", "schoolId": "school-2"},
    }
  }
}

test_platform_admin_has_read_and_pricing_only_phase_one_grants if {
  every action in finance_actions {
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

  not authorization.allow with input as {
    "action": "school.billing.run.post",
    "subject": {
      "userId": "admin-1",
      "roleAssignments": [
        {"role": "platform.admin", "scope": {"kind": "platform"}},
      ],
    },
    "resource": {"kind": "school", "schoolId": "school-1"},
  }


  every action in finance_post_actions {
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
