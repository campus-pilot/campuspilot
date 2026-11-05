import type { AssistantItemDto, AssistantRunDto } from '@campuspilot/assistant-contract/dto';
import { describe, expect, it } from 'vitest';

import { splitMarkdownBlocks } from './assistant-markdown';
import { activeRun, buildAssistantTimeline, summarizeActivity } from './timeline-model';

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
const run = (id: string, status: AssistantRunDto['status']): AssistantRunDto => ({
  id, conversationId: 'c', status, surface: 'page', stopRequestedAt: null, errorCode: null,
  errorMessage: status === 'failed' ? 'Boom' : null, sequence: 1, createdAt: at, startedAt: null, completedAt: null,
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
    expect(rows.map((row) => row.kind)).toEqual(['user', 'activity', 'approval', 'reply']);
    expect(rows[1]).toMatchObject({ kind: 'activity', calls: [{ id: 'a' }, { id: 'b' }] });
  });

  it('adds a notice where a failed run ends', () => {
    const rows = buildAssistantTimeline([user('u1', 1), user('u2', 2, 'r2')], [run('r1', 'failed'), run('r2', 'completed')]);
    expect(rows.map((row) => row.kind)).toEqual(['user', 'notice', 'user']);
  });
});

describe('helpers', () => {
  it('summarises activity', () => {
    const calls = [call('a', 1), call('b', 2)].filter((item) => item.kind === 'tool_call');
    expect(summarizeActivity(calls as never)).toBe('Looked up 2 records');
  });

  it('finds the run still working', () => {
    expect(activeRun([run('r1', 'completed'), run('r2', 'awaiting_approval')])?.id).toBe('r2');
    expect(activeRun([run('r1', 'completed')])).toBeNull();
  });

  it('splits markdown at blank lines outside code fences', () => {
    expect(splitMarkdownBlocks('a\n\nb')).toEqual(['a', 'b']);
    expect(splitMarkdownBlocks('```\nx\n\ny\n```\n\nz')).toEqual(['```\nx\n\ny\n```', 'z']);
  });
});
