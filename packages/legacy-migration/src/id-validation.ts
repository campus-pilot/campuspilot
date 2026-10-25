import { entityIdSchema, type EntityName } from '@campuspilot/db/id';

const PRESERVED_ID_ENTITIES = {
  school: 'school', school_session: 'schoolSession', class: 'class', section: 'section',
  admission: 'admission', student: 'student', exam_plan: 'examPlan',
  exam_result: 'examResult', exam_timetable: 'examTimetable', artifact: 'artifact',
} as const satisfies Record<string, EntityName>;

const AUTH_ID = /^(usr|acc)_[a-z0-9]{21}$/;

/** Validate prefix, separator, lowercase alphabet, and exact 21-char suffix. */
export function assertPreservedIds(rows: Record<string, Array<Record<string, unknown>>>) {
  for (const [table, entity] of Object.entries(PRESERVED_ID_ENTITIES)) {
    for (const row of rows[table] ?? []) {
      const parsed = entityIdSchema(entity).safeParse(row.id);
      if (!parsed.success) throw new Error(`Invalid preserved ${table} ID: ${String(row.id)}`);
    }
  }
  for (const table of ['user', 'account']) {
    for (const row of rows[table] ?? []) {
      if (typeof row.id !== 'string' || !AUTH_ID.test(row.id))
        throw new Error(`Invalid preserved ${table} ID: ${String(row.id)}`);
    }
  }
}
