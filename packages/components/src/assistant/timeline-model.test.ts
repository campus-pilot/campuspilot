import type { AssistantItemDto, AssistantRunDto } from '@campuspilot/assistant-contract/dto';
import { describe, expect, it } from 'vitest';

import { splitMarkdownBlocks } from './assistant-markdown';
import { activeRun, buildAssistantTimeline, pendingApprovals, queuedMessages, summarizeActivity } from './timeline-model';

const at = new Date('2026-11-05T00:00:00Z');
const base = { conversationId: 'c', runId: 'r1', sequence: 1, createdAt: at, updatedAt: at };
const user = (id: string, position: number, runId = 'r1'): AssistantItemDto => ({
  ...base, id, position, runId, kind: 'user_message', status: 'complete', body: { text: 'q' },
});
const call = (id: string, position: number, extra: Partial<Extract<AssistantItemDto, { kind: 'tool_call' }>['body']> = {}, status: 'succeeded' | 'awaiting_approval' = 'succeeded'): AssistantItemDto => ({
  ...base, id, position, kind: 'tool_call', status,
  body: { toolUseId: id, toolName: 'school.listStudents', title: 'List students', access: 'read', destructive: false, module: 'students', input: {}, ...extra },
});
const reply = (id: string, position: number, text: string): AssistantItemDto => ({
  ...base, id, position, kind: 'assistant_message', status: 'complete', body: { text },
});
const run = (id: string, status: AssistantRunDto['status'], startedAt: Date | null = null): AssistantRunDto => ({
  id, conversationId: 'c', status, surface: 'page', stopRequestedAt: null, errorCode: null,
  errorMessage: status === 'failed' ? 'Boom' : null, sequence: 1, createdAt: at, startedAt,
  completedAt: startedAt && ['completed', 'failed', 'cancelled'].includes(status) ? new Date(startedAt.getTime() + 18_000) : null,
  diagnostics: null,
});

describe('buildAssistantTimeline', () => {
  it('groups reads, keeps approvals separate and skips empty replies', () => {
    const rows = buildAssistantTimeline(
      [
        user('u', 1),
        call('a', 2),
        call('b', 3),
        reply('empty', 4, '  '),
        call('w', 5, { access: 'write', approvalId: 'ap' }, 'awaiting_approval'),
        reply('answer', 6, 'Done'),
      ],
      [run('r1', 'running')],
    );
    expect(rows.map((row) => row.kind)).toEqual(['user', 'work', 'activity', 'approval', 'reply']);
    expect(rows[2]).toMatchObject({ kind: 'activity', calls: [{ id: 'a' }, { id: 'b' }] });
  });

  it('folds a finished turn under its bar, keeping views and the final answer', () => {
    const view = { ...base, id: 'v', position: 4, kind: 'view', status: 'complete', body: { view: { type: 'notice', tone: 'neutral', text: 'x' } } } as AssistantItemDto;
    const rows = buildAssistantTimeline(
      [user('u', 1), call('a', 2), reply('interim', 3, 'Looking'), view, reply('final', 5, 'Done')],
      [run('r1', 'completed', at)],
    );
    expect(rows.map((row) => row.kind)).toEqual(['user', 'work', 'view', 'reply']);
    expect(rows[1]).toMatchObject({ state: 'done', since: at, folded: [{ kind: 'activity' }, { kind: 'reply', itemId: 'interim' }] });
    expect(rows[3]).toMatchObject({ itemId: 'final', meta: true });
  });

  it('pauses the bar on a change waiting for approval', () => {
    const rows = buildAssistantTimeline(
      [user('u', 1), call('w', 2, { access: 'write', approvalId: 'ap' }, 'awaiting_approval')],
      [run('r1', 'awaiting_approval', at)],
    );
    expect(rows[1]).toMatchObject({ kind: 'work', state: 'paused', pending: { id: 'w' } });
  });

  it('adds a notice where a failed run ends', () => {
    const rows = buildAssistantTimeline([user('u1', 1), user('u2', 2, 'r2')], [run('r1', 'failed'), run('r2', 'completed')]);
    expect(rows.map((row) => row.kind)).toEqual(['user', 'notice', 'user']);
  });
});

describe('live row', () => {
  const streaming = (id: string, position: number): AssistantItemDto => ({
    ...base, id, position, kind: 'assistant_message', status: 'streaming', body: { text: '' },
  });
  const view = (id: string, position: number): AssistantItemDto => ({
    ...base, id, position, kind: 'view', status: 'complete',
    body: { view: { type: 'notice', tone: 'neutral', text: 'Heads up' } },
  });

  it('shows Thinking while the model works between tools', () => {
    expect(buildAssistantTimeline([user('u', 1)], [run('r1', 'running', at)]).map((row) => row.kind)).toEqual(['user', 'work', 'live']);
    expect(buildAssistantTimeline([user('u', 1), call('a', 2)], [run('r1', 'running', at)]).at(-1)).toMatchObject({ kind: 'live', label: 'Thinking' });
  });

  it('keeps queued messages out of the timeline', () => {
    const items = [user('u1', 1), user('u2', 2, 'r2')];
    const runs = [run('r1', 'running', at), run('r2', 'queued')];
    expect(buildAssistantTimeline(items, runs).map((row) => row.id)).toEqual(['u1', 'work:r1', 'live:r1']);
    expect(queuedMessages(items, runs).map((item) => item.id)).toEqual(['u2']);
  });

  it('hides while a reply streams, an approval waits, or nothing runs', () => {
    const kinds = (items: AssistantItemDto[], status: AssistantRunDto['status']) =>
      buildAssistantTimeline(items, [run('r1', status)]).map((row) => row.kind);
    expect(kinds([user('u', 1), streaming('s', 2)], 'running')).not.toContain('live');
    expect(kinds([user('u', 1), call('w', 2, { access: 'write', approvalId: 'ap' }, 'awaiting_approval')], 'awaiting_approval')).not.toContain('live');
    expect(kinds([user('u', 1)], 'completed')).not.toContain('live');
  });

  it('renders views as their own rows', () => {
    expect(buildAssistantTimeline([user('u', 1), view('v', 2)], [run('r1', 'completed', at)]).map((row) => row.kind)).toEqual(['user', 'work', 'view']);
  });
});

describe('helpers', () => {
  it('summarises activity', () => {
    const calls = [call('a', 1), call('b', 2)].filter((item) => item.kind === 'tool_call');
    expect(summarizeActivity(calls as never)).toBe('Looked up 2 records');
    const mixed = [call('a', 1), call('b', 2, { access: 'write' })].filter((item) => item.kind === 'tool_call');
    expect(summarizeActivity(mixed as never)).toBe('Looked up 1 record and updated 1 record');
  });

  it('lists changes waiting for a decision', () => {
    expect(pendingApprovals([call('a', 1), call('w', 2, { access: 'write' }, 'awaiting_approval')]).map((item) => item.id)).toEqual(['w']);
  });

  it('finds the run still working', () => {
    expect(activeRun([run('r1', 'completed'), run('r2', 'awaiting_approval')])?.id).toBe('r2');
    expect(activeRun([run('r1', 'running'), run('r2', 'queued')])?.id).toBe('r1');
    expect(activeRun([run('r1', 'completed')])).toBeNull();
  });

  it('splits markdown at blank lines outside code fences', () => {
    expect(splitMarkdownBlocks('a\n\nb')).toEqual(['a', 'b']);
    expect(splitMarkdownBlocks('```\nx\n\ny\n```\n\nz')).toEqual(['```\nx\n\ny\n```', 'z']);
  });
});
