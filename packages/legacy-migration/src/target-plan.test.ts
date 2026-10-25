import { expect, it } from 'vitest';
import { CANONICAL_DECISION_POLICY } from './canonical-decisions.ts';
import { buildTargetMigrationPlan, proposeExecutionPlan } from './target-plan.ts';

it('uses one deterministic approved execution plan and rejects divergence', () => {
  const base: any = {
    mapping: {
      roles: { admin: 'principal' },
      migrationActor: 'migration:synthetic',
      sessions: [{ sourceId: 'sess', isActive: true }],
      classes: [{ sourceId: 'class', displayOrder: 1 }],
      sections: [{ sourceId: 'section', displayOrder: 1 }],
      templates: [],
      assessmentSettings: [],
      decisionPolicy: CANONICAL_DECISION_POLICY,
    },
    sourceVersion: 'v1', staff: [{ id: 'stf', role: 'admin' }],
    sessions: [{ id: 'sess', sessionStartYear: 2026, sessionEndYear: 2027 }], classes: [{ id: 'class', slug: '1' }], sections: [{ id: 'section', class_id: 'class', slug: 'a' }],
    billRuns: [],
    bills: [
      { id: 'bill-b', created_at: '2026-07-02', line_items: {} },
      { id: 'bill-a', created_at: '2026-07-01', line_items: {} },
    ],
    ledger: [{ id: 'pay-a', amount: '1.00', discount: '0.00', created_at: '2026-07-03' }],
  };
  base.mapping.executionPlan = proposeExecutionPlan(base);
  expect(buildTargetMigrationPlan(base)).toMatchObject({
    staffRoles: { stf: 'principal' },
    activeSessions: { sess: true },
    classDisplayOrders: { class: 1 },
    sectionDisplayOrders: { section: 1 },
    billNumbers: {
      'bill-a': 'BILL/2026-2027/000361',
      'bill-b': 'BILL/2026-2027/000362',
    },
    receiptNumbers: { 'pay-a': 'RCP/2026-2027/000153' },
    financeNumberCounters: {
      sessionId: 'sess',
      fiscalKey: '2026-2027',
      nextValues: { bill: 363, receipt: 154, refund: 1 },
    },
  });
  base.mapping.classes[0].displayOrder = 2;
  expect(buildTargetMigrationPlan(base).classDisplayOrders.class).toBe(1);
  base.mapping.executionPlan = { ...base.mapping.executionPlan, migrationActor: 'tampered' };
  expect(() => buildTargetMigrationPlan(base)).toThrow('diverges');
});
