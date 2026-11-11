import { generateId as generateDbId, type EntityName } from '@campuspilot/db/id';

const ENTITIES = {
  approval: 'assistantApproval',
  conversation: 'assistantConversation',
  item: 'assistantItem',
  run: 'assistantRun',
} as const satisfies Record<string, EntityName>;

/** Prefixed random ids in the platform's `<prefix>_<21 base-36 chars>` shape (`asa_`, `asc_`, `asi_`, `asr_`). */
export function generateId(entity: keyof typeof ENTITIES): string {
  return generateDbId(ENTITIES[entity]);
}
