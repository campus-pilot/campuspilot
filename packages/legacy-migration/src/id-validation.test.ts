import { expect, it } from 'vitest';
import { entityIdSchema, generateId } from '@campuspilot/db/id';
import { assertPreservedIds } from './id-validation.ts';

it('validates every preserved prefix and exact lowercase 21-character suffix', () => {
  expect(() => assertPreservedIds({ school: [{ id: `sch_${'a'.repeat(21)}` }], exam_plan: [{ id: `expl_${'1'.repeat(21)}` }] })).not.toThrow();
  expect(() => assertPreservedIds({ school: [{ id: 'sch_short' }] })).toThrow('Invalid preserved');
  expect(() => assertPreservedIds({ user: [{ id: `usr_${'A'.repeat(21)}` }] })).toThrow('Invalid preserved');
});

it.each([
  ['examPlan', 'expl_'],
  ['examResult', 'exrs_'],
  ['examTimetable', 'ett_'],
] as const)('generates target %s IDs with the legacy-compatible prefix', (entity, prefix) => {
  const id = generateId(entity);
  expect(id).toMatch(new RegExp(`^${prefix}[a-z0-9]{21}$`));
  expect(entityIdSchema(entity).parse(id)).toBe(id);
});
