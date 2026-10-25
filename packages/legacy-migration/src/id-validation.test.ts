import { expect, it } from 'vitest';
import { entityIdSchema, generateId } from '@campuspilot/db/id';
import { assertPreservedIds } from './id-validation.ts';

it('validates CampusPilot entity prefixes independently from legacy auth IDs', () => {
  expect(() => assertPreservedIds({ school: [{ id: `sch_${'a'.repeat(21)}` }], exam_plan: [{ id: `expl_${'1'.repeat(21)}` }] })).not.toThrow();
  expect(() => assertPreservedIds({ school: [{ id: 'sch_short' }] })).toThrow('Invalid preserved');
});

it('accepts only the exact 32-character base62 Better Auth shape observed in frozen evidence', () => {
  expect(() => assertPreservedIds({
    user: [{ id: '1Abcdefghijklmnopqrstuvwxyz23456' }],
    account: [{ id: 'Zyxwvutsrqponmlkjihgfedcba987654' }],
  })).not.toThrow();
});

it.each([
  '',
  'short',
  'A'.repeat(31),
  'A'.repeat(33),
  `usr_${'a'.repeat(21)}`,
  '1Abcdefghijklmnopqrstuvwxyz2345_',
  '1Abcdefghijklmnopqrstuvwxyz2345-',
  '1Abcdefghijklmnopqrstuvwxyz2345é',
  '1Abcdefghijklmnopqrstuvwxyz2345/',
])('rejects malformed or ambiguous legacy auth ID %j', (id) => {
  expect(() => assertPreservedIds({ user: [{ id }] })).toThrow('Invalid preserved user ID');
  expect(() => assertPreservedIds({ account: [{ id }] })).toThrow('Invalid preserved account ID');
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
