package campuspilot.authorization.class_scope_test

import rego.v1

import data.campuspilot.authorization

test_teacher_can_add_student_to_any_assigned_class if {
  authorization.allow with input as {
    "action": "class.student.add",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [
        {"role": "school.exam_coordinator", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null},
        {
          "role": "school.teacher",
          "scope": {"kind": "school", "schoolId": "school-1"},
          "meta": {"classIds": ["class-1", "class-2"]},
        },
      ],
    },
    "resource": {
      "kind": "class",
      "schoolId": "school-1",
      "classId": "class-2",
    },
  }
}

test_teacher_cannot_access_an_unassigned_class if {
  not authorization.allow with input as {
    "action": "class.student.add",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [
        {"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": {"classIds": ["class-1"]}},
      ],
    },
    "resource": {
      "kind": "class",
      "schoolId": "school-1",
      "classId": "class-2",
    },
  }
}

test_teacher_cannot_use_an_assignment_from_another_school if {
  not authorization.allow with input as {
    "action": "class.student.add",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [
        {"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": {"classIds": ["class-1"]}},
      ],
    },
    "resource": {
      "kind": "class",
      "schoolId": "school-2",
      "classId": "class-1",
    },
  }
}

test_teacher_without_class_metadata_is_denied if {
  not authorization.allow with input as {
    "action": "class.student.add",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [{"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": null}],
    },
    "resource": {
      "kind": "class",
      "schoolId": "school-1",
      "classId": "class-1",
    },
  }
}

test_teacher_with_null_class_ids_is_denied if {
  not authorization.allow with input as {
    "action": "class.student.add",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [
        {"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": {"classIds": null}},
      ],
    },
    "resource": {
      "kind": "class",
      "schoolId": "school-1",
      "classId": "class-1",
    },
  }
}

test_teacher_with_no_classes_is_denied if {
  not authorization.allow with input as {
    "action": "class.student.add",
    "subject": {
      "userId": "user-1",
      "roleAssignments": [
        {"role": "school.teacher", "scope": {"kind": "school", "schoolId": "school-1"}, "meta": {"classIds": []}},
      ],
    },
    "resource": {
      "kind": "class",
      "schoolId": "school-1",
      "classId": "class-1",
    },
  }
}
