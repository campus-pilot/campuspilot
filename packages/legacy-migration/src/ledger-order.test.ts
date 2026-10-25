import { expect, it } from 'vitest';
import { compareLegacyLedgerCandidates } from './ledger-order.ts';

it('uses source-table precedence before source primary key at equal timestamps', () => {
  const rows = [
    { admissionId: 'adm', at: '2026-07-01T00:00:00+05:30', order: 2, sourceId: 'a' },
    { admissionId: 'adm', at: '2026-07-01T00:00:00+05:30', order: 0, sourceId: 'z' },
    { admissionId: 'adm', at: '2026-07-01T00:00:00+05:30', order: 1, sourceId: 'b' },
    { admissionId: 'adm', at: '2026-07-01T00:00:00+05:30', order: 1, sourceId: 'a' },
  ].toSorted(compareLegacyLedgerCandidates);

  expect(rows.map(({ order, sourceId }) => `${order}:${sourceId}`)).toEqual([
    '0:z',
    '1:a',
    '1:b',
    '2:a',
  ]);
});
