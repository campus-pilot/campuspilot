package campuspilot.authorization.class_scope_test

import rego.v1

import data.campuspilot.authorization

test_teacher_can_add_student_to_any_assigned_class if {
  authorization.allow with input as {
    "action": "class.student.add",
    "subject": {
      "userId": "user-1",
      "systemRole": "user",
      "roleAssignments": [
        {"role": "exam_coordinator", "meta": null},
        {
          "role": "teacher",
          "meta": {"classIds": ["class-1", "class-2"]},
        },
      ],
    },
    "resource": {
      "level": "class",
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
      "systemRole": "user",
      "roleAssignments": [
        {"role": "teacher", "meta": {"classIds": ["class-1"]}},
      ],
    },
    "resource": {
      "level": "class",
      "schoolId": "school-1",
      "classId": "class-2",
    },
  }
}

test_teacher_without_class_metadata_is_denied if {
  not authorization.allow with input as {
    "action": "class.student.add",
    "subject": {
      "userId": "user-1",
      "systemRole": "user",
      "roleAssignments": [{"role": "teacher", "meta": null}],
    },
    "resource": {
      "level": "class",
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
      "systemRole": "user",
      "roleAssignments": [
        {"role": "teacher", "meta": {"classIds": null}},
      ],
    },
    "resource": {
      "level": "class",
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
      "systemRole": "user",
      "roleAssignments": [
        {"role": "teacher", "meta": {"classIds": []}},
      ],
    },
    "resource": {
      "level": "class",
      "schoolId": "school-1",
      "classId": "class-1",
    },
  }
}
