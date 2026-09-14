package campuspilot.authorization.catalog

import rego.v1

generation_manifest := {
  "actions": actions,
  "grants": grants,
}

role_has_action(role, action) if {
  some grant in grants
  grant.role == role
  grant.action == action
}

action_targets_resource(action, resource_kind) if {
  some definition in actions
  definition.id == action
  definition.resourceKind == resource_kind
}
