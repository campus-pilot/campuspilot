import type { AssistantItemDto, AssistantRunDto } from '@campuspilot/assistant-contract/dto';
import { describe, expect, it } from 'vitest';

import { turnOutcomeOf, turnUpdatesOf } from './turn-watch';

const at = new Date('2026-11-15T10:00:00Z');

function run(status: AssistantRunDto['status'], extra: Partial<AssistantRunDto> = {}): AssistantRunDto {
  return {
    id: 'run1',
    conversationId: 'c1',
    userId: 'u1',
    status,
    surface: 'panel',
    stopRequestedAt: null,
    errorCode: null,
    errorMessage: null,
    sequence: 1,
    createdAt: at,
    startedAt: at,
    completedAt: null,
    diagnostics: null,
    ...extra,
  };
}

const base = (id: string, position: number, runId = 'run1') => ({ id, conversationId: 'c1', runId, position, sequence: position, createdAt: at, updatedAt: at });

const reply = (id: string, position: number, text: string, runId?: string): AssistantItemDto => ({
  ...base(id, position, runId),
  kind: 'assistant_message',
  status: 'complete',
  body: { text },
});

const change = (id: string, position: number, status: 'awaiting_approval' | 'succeeded' | 'declined', title: string): AssistantItemDto => ({
  ...base(id, position),
  kind: 'tool_call',
  status,
  body: { toolUseId: id, toolName: 'school.recordPayment', title, access: 'write', destructive: false, module: 'fees', input: {} },
});

const table = (id: string, position: number, title?: string): AssistantItemDto => ({
  ...base(id, position),
  kind: 'view',
  status: 'complete',
  body: { view: { type: 'table', ...(title ? { title } : {}), columns: [{ key: 'a', label: 'A' }], rows: [{ a: '1' }] } as never },
});

describe('turnOutcomeOf', () => {
  it('gives the answer, what is on screen and the changes of this run only, in order', () => {
    const outcome = turnOutcomeOf(run('completed'), [
      reply('i9', 9, 'Another run’s answer', 'run0'),
      table('i3', 3, 'Below 40% in Maths'),
      reply('i4', 4, 'Three students are below 40%.'),
      reply('i1', 1, 'Looking at Class 8-B.'),
      change('i2', 2, 'succeeded', 'Record a payment of ₹4,500'),
      change('i5', 5, 'declined', 'Delete the fee head'),
      table('i6', 6),
    ]);
    expect(outcome).toEqual({
      status: 'done',
      answer: 'Looking at Class 8-B.\n\nThree students are below 40%.',
      onScreen: ['Table: Below 40% in Maths', 'Table'],
      changesMade: ['Record a payment of ₹4,500'],
      changesDeclined: ['Delete the fee head'],
    });
  });

  it('cuts a very long answer: the voice says a sentence or two of it', () => {
    const outcome = turnOutcomeOf(run('completed'), [reply('i1', 1, 'a'.repeat(5_000))]);
    expect(outcome.status === 'done' && outcome.answer.length).toBe(4_001);
  });

  it('says why a run failed, and that a cancelled one was stopped', () => {
    expect(turnOutcomeOf(run('failed', { errorMessage: 'The school reached its limit.' }), [])).toEqual({ status: 'failed', error: 'The school reached its limit.' });
    expect(turnOutcomeOf(run('failed'), [])).toEqual({ status: 'failed', error: 'The assistant could not finish this request.' });
    expect(turnOutcomeOf(run('cancelled'), [reply('i1', 1, 'Half an answer')])).toEqual({ status: 'stopped' });
  });
});

describe('turnUpdatesOf', () => {
  it('says nothing while the run works', () => {
    expect(turnUpdatesOf(run('running'), [reply('i1', 1, 'Working')], new Set())).toEqual({ updates: [], announced: [] });
  });

  it('names each change waiting for approval once', () => {
    const items = [change('i1', 1, 'awaiting_approval', 'Record a payment of ₹4,500')];
    const first = turnUpdatesOf(run('awaiting_approval'), items, new Set());
    expect(first).toEqual({ updates: [{ type: 'approval', change: 'Record a payment of ₹4,500' }], announced: ['i1'] });
    expect(turnUpdatesOf(run('awaiting_approval'), items, new Set(first.announced)).updates).toEqual([]);
  });

  it('settles with the outcome once the run has ended', () => {
    const { updates } = turnUpdatesOf(run('completed'), [reply('i1', 1, 'Done.')], new Set());
    expect(updates).toEqual([{ type: 'settled', outcome: { status: 'done', answer: 'Done.', onScreen: [], changesMade: [], changesDeclined: [] } }]);
  });
});
