import { entityIdSchema, type EntityName } from '@campuspilot/db/id';

const PRESERVED_ID_ENTITIES = {
  school: 'school', school_session: 'schoolSession', class: 'class', section: 'section',
  admission: 'admission', student: 'student', exam_plan: 'examPlan',
  exam_result: 'examResult', exam_timetable: 'examTimetable', artifact: 'artifact',
} as const satisfies Record<string, EntityName>;

/**
 * The legacy app used Better Auth's default `generateId(32)`, whose alphabet
 * is exactly ASCII base62 (`a-z`, `A-Z`, `0-9`). These identifiers were never
 * CampusPilot entity IDs and must be preserved byte-for-byte.
 */
const LEGACY_BETTER_AUTH_ID = /^[A-Za-z0-9]{32}$/;

/** Validate each preserved ID against its source system's exact ID contract. */
export function assertPreservedIds(rows: Record<string, Array<Record<string, unknown>>>) {
  for (const [table, entity] of Object.entries(PRESERVED_ID_ENTITIES)) {
    for (const row of rows[table] ?? []) {
      const parsed = entityIdSchema(entity).safeParse(row.id);
      if (!parsed.success) throw new Error(`Invalid preserved ${table} ID: ${String(row.id)}`);
    }
  }
  for (const table of ['user', 'account']) {
    for (const row of rows[table] ?? []) {
      if (typeof row.id !== 'string' || !LEGACY_BETTER_AUTH_ID.test(row.id))
        throw new Error(`Invalid preserved ${table} ID: ${String(row.id)}`);
    }
  }
}
