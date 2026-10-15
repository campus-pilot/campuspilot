package campuspilot.authorization.school_documents_test
import rego.v1
import data.campuspilot.authorization
request(action, role, school_id) := {
 "action": action,
 "subject": {"userId": "u1", "roleAssignments": [{"role": role, "scope": {"kind": "school", "schoolId": school_id}, "meta": null}]},
 "resource": {"kind": "school", "schoolId": "school-1"},
}
test_document_read_grants if {
 every role in {"school.teacher", "school.accountant", "school.principal", "school.manager", "school.exam_coordinator"} {
  every action in {"school.document.templates.read", "school.document.artifacts.read"} {
   authorization.allow with input as request(action, role, "school-1")
   not authorization.allow with input as request(action, role, "school-2")
  }
 }
}
test_document_mutation_grants if {
 every action in {"school.document.templates.manage", "school.document.generate", "school.document.artifacts.delete"} {
  every role in {"school.principal", "school.manager", "school.exam_coordinator"} {
   authorization.allow with input as request(action, role, "school-1")
   not authorization.allow with input as request(action, role, "school-2")
  }
  every role in {"school.teacher", "school.accountant", "platform.admin"} {
   not authorization.allow with input as request(action, role, "school-1")
  }
 }
}
test_invalid_document_facts_denied if {
 not authorization.allow with input as {"action": "school.document.generate", "resource": {"kind": "school", "schoolId": "school-1"}}
 not authorization.allow with input as object.union(request("school.document.generate", "school.manager", "school-1"), {"resource": {"kind": "class", "schoolId": "school-1", "classId": "c1"}})
 not authorization.allow with input as request("school.document.unknown", "school.manager", "school-1")
 not authorization.allow with input as object.union(request("school.document.generate", "school.manager", "school-1"), {"subject": {"userId": "u1", "roleAssignments": [{"role": "school.manager", "scope": {"kind": "platform"}}]}})
}
