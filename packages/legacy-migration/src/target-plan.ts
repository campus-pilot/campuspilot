import { createHash } from 'node:crypto';
import { CANONICAL_DECISION_POLICY } from './canonical-decisions.ts';
import { stableJson } from './source-evidence.ts';

type Row = Record<string, any>;

const LEGACY_ROLE_POLICY: Record<string, string> = {
  admin: 'principal',
  manager: 'manager',
  teacher: 'teacher',
  accountant: 'accountant',
  exam_coordinator: 'exam_coordinator',
};

function classRank(slug: string) {
  const normalized = slug.toLowerCase();
  if (normalized === 'nursery') return 1;
  if (normalized === 'lkg') return 2;
  if (normalized === 'ukg') return 3;
  if (/^\d+$/.test(normalized)) return 3 + Number(normalized);
  return 10_000;
}

function generatedId(prefix: string, sourceVersion: string, identity: string) {
  return `${prefix}_${createHash('sha256').update(`${sourceVersion}:${identity}`).digest('hex').slice(0, 21)}`;
}

function financeNumber(kind: 'bill' | 'receipt', session: string, sequence: number) {
  const pattern = kind === 'bill'
    ? CANONICAL_DECISION_POLICY['F-07'].billNumberPattern
    : CANONICAL_DECISION_POLICY['F-07'].receiptNumberPattern;
  return pattern
    .replace('{session}', session)
    .replace('{sequence:6}', String(sequence).padStart(6, '0'));
}

/**
 * Assign the frozen legacy facts the contiguous range immediately preceding
 * the checksum-bound next counter. This makes the first post-migration allocation
 * deterministic and proves that it cannot reuse an imported number.
 */
function financeNumbers(
  kind: 'bill' | 'receipt',
  session: string,
  orderedRows: Row[],
) {
  const nextValue = CANONICAL_DECISION_POLICY['F-07'].nextValues[kind];
  const first = nextValue - orderedRows.length;
  if (orderedRows.length > 0 && first < 1)
    throw new Error(`Approved ${kind} next counter cannot cover all source rows`);
  return Object.fromEntries(
    orderedRows.map((row, index) => [
      row.id,
      financeNumber(kind, session, first + index),
    ]),
  );
}

export function proposeExecutionPlan(options: {
  mapping: Record<string, any>;
  sourceVersion: string;
  staff: Row[]; sessions: Row[]; classes: Row[]; sections: Row[];
  billRuns: Row[]; bills: Row[]; ledger: Row[];
}) {
  const classOrders = Object.fromEntries([...options.classes]
    .toSorted((left, right) => classRank(String(left.slug)) - classRank(String(right.slug)) ||
      String(left.slug).localeCompare(String(right.slug)) || String(left.id).localeCompare(String(right.id)))
    .map((entry, index) => [entry.id, index + 1]));
  const sectionOrders = Object.fromEntries(options.classes.flatMap((klass) => options.sections
    .filter((entry) => entry.class_id === klass.id)
    .toSorted((left, right) => String(left.slug).localeCompare(String(right.slug)) ||
      String(left.id).localeCompare(String(right.id)))
    .map((entry, index) => [entry.id, index + 1])));
  const activeSessions = Object.fromEntries(options.sessions.map((entry) => [entry.id, true]));
  const generatedIds: Record<string, string> = {};
  for (const run of options.billRuns) generatedIds[`billRun:${run.id}`] = generatedId('frun', options.sourceVersion, `bill_generation_event:${run.id}`);
  for (const bill of options.bills) {
    generatedIds[`bill:${bill.id}`] = generatedId('fbill', options.sourceVersion, `student_bill_event:${bill.id}`);
    generatedIds[`ledger:bill:${bill.id}`] = generatedId('fled', options.sourceVersion, `bill:${bill.id}`);
    for (const slug of Object.keys(bill.line_items ?? {}).toSorted())
      generatedIds[`billLine:${bill.id}:${slug}`] = generatedId('fline', options.sourceVersion, `student_bill_event:${bill.id}:line:${slug}`);
  }
  for (const event of options.ledger) {
    generatedIds[`ledger:payment:${event.id}`] = generatedId('fled', options.sourceVersion, `payment:${event.id}`);
    generatedIds[`payment:${event.id}`] = generatedId('fpay', options.sourceVersion, `ledger_event:${event.id}:payment`);
    if (Number(event.discount) > 0) {
      generatedIds[`ledger:discount:${event.id}`] = generatedId('fled', options.sourceVersion, `discount:${event.id}`);
      generatedIds[`adjustment:${event.id}`] = generatedId('fadj', options.sourceVersion, `ledger_event:${event.id}:discount`);
    }
  }
  const session = options.sessions[0];
  const fiscalLabel = session
    ? `${session.sessionStartYear}-${session.sessionEndYear}`
    : '';
  const orderedBills = [...options.bills].toSorted((left, right) =>
    String(left.created_at).localeCompare(String(right.created_at)) ||
    String(left.id).localeCompare(String(right.id)));
  const orderedReceipts = options.ledger
    .filter((event) => Number(event.amount) > 0)
    .toSorted((left, right) =>
      String(left.created_at).localeCompare(String(right.created_at)) ||
      String(left.id).localeCompare(String(right.id)));
  return {
    schemaVersion: 1,
    migrationActor: `migration:${options.sourceVersion}`,
    staffRoles: Object.fromEntries(options.staff.map((member) => [member.id, LEGACY_ROLE_POLICY[member.role]])),
    staffClassScopes: Object.fromEntries(options.staff.map((member) => [member.id,
      member.role === 'teacher' ? Object.entries(member.attributes ?? {}).filter(([, sectionIds]) => Array.isArray(sectionIds) && sectionIds.length > 0).map(([classId]) => classId).toSorted() : null,
    ])),
    activeSessions,
    classDisplayOrders: classOrders,
    sectionDisplayOrders: sectionOrders,
    templates: options.mapping.templates ?? [],
    schoolLogo: options.mapping.schoolLogo ?? null,
    assessmentSettings: options.mapping.assessmentSettings ?? [],
    decisionPolicy: options.mapping.decisionPolicy,
    financeRebuilds: options.mapping.financeRebuilds ?? [],
    generatedIds,
    financeNumberCounters: {
      sessionId: session?.id ?? '',
      fiscalKey: fiscalLabel,
      nextValues: CANONICAL_DECISION_POLICY['F-07'].nextValues,
    },
    billNumbers: financeNumbers('bill', fiscalLabel, orderedBills),
    receiptNumbers: financeNumbers('receipt', fiscalLabel, orderedReceipts),
  };
}

/** Build the sole executable target plan and reject any approved-plan drift. */
export function buildTargetMigrationPlan(options: Parameters<typeof proposeExecutionPlan>[0]) {
  const proposed = proposeExecutionPlan(options);
  const approved = options.mapping.executionPlan;
  if (!approved || stableJson(approved) !== stableJson(proposed))
    throw new Error('Approved executionPlan diverges from the deterministic source/mapping plan');
  if (typeof approved.migrationActor !== 'string' || !approved.migrationActor.trim())
    throw new Error('Approved executionPlan must name a migration actor');
  if (Object.values(approved.staffRoles).some((role) => typeof role !== 'string' || !role))
    throw new Error('Approved executionPlan contains an unresolved staff role');
  for (const member of options.staff) {
    if (typeof approved.staffRoles[member.id] !== 'string')
      throw new Error(`Approved executionPlan has no role for staff ${member.id}`);
    const scope = approved.staffClassScopes[member.id];
    if (member.role === 'teacher' ? !Array.isArray(scope) : scope !== null)
      throw new Error(`Approved executionPlan has an invalid class scope for staff ${member.id}`);
  }
  for (const session of options.sessions) {
    if (typeof approved.activeSessions[session.id] !== 'boolean')
      throw new Error(`Approved executionPlan has no active-session decision for ${session.id}`);
  }
  for (const [label, rows, orders] of [
    ['class', options.classes, approved.classDisplayOrders],
    ['section', options.sections, approved.sectionDisplayOrders],
  ] as const) {
    for (const row of rows) {
      const order = orders[row.id];
      if (!Number.isSafeInteger(order) || order < 1)
        throw new Error(`Approved executionPlan has an invalid ${label} display order for ${row.id}`);
    }
  }
  for (const [key, id] of Object.entries(approved.generatedIds)) {
    if (typeof id !== 'string' || !/^(frun|fbill|fled|fline|fpay|fadj)_[0-9a-f]{21}$/.test(id))
      throw new Error(`Approved executionPlan has an invalid generated ID for ${key}`);
  }
  for (const bill of options.bills)
    if (!/^BILL\/\d{4}-\d{4}\/\d{6}$/.test(approved.billNumbers[bill.id] ?? ''))
      throw new Error(`Approved executionPlan has invalid bill numbering for ${bill.id}`);
  for (const event of options.ledger.filter((entry) => Number(entry.amount) > 0))
    if (!/^RCP\/\d{4}-\d{4}\/\d{6}$/.test(approved.receiptNumbers[event.id] ?? ''))
      throw new Error(`Approved executionPlan has invalid receipt numbering for ${event.id}`);
  if (approved.financeNumberCounters.sessionId !== options.sessions[0]?.id ||
    approved.financeNumberCounters.fiscalKey !== `${options.sessions[0]?.sessionStartYear}-${options.sessions[0]?.sessionEndYear}` ||
    stableJson(approved.financeNumberCounters.nextValues) !==
      stableJson(CANONICAL_DECISION_POLICY['F-07'].nextValues))
    throw new Error('Approved executionPlan has invalid finance number counters');
  return approved as ReturnType<typeof proposeExecutionPlan>;
}
