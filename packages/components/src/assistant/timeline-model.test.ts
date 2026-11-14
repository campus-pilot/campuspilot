import type { AssistantItemDto, AssistantRunDto } from '@campuspilot/assistant-contract/dto';
import { describe, expect, it } from 'vitest';

import { splitMarkdownBlocks } from './assistant-markdown';
import {
  activeRun,
  approvalsByDecider,
  assistantAnnouncement,
  buildAssistantTimeline,
  pendingApprovals,
  queuedMessages,
  summarizeActivity,
} from './timeline-model';

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
  id, conversationId: 'c', userId: 'u', status, surface: 'page', stopRequestedAt: null, errorCode: null,
  errorMessage: status === 'failed' ? 'Boom' : null, sequence: 1, createdAt: at, startedAt,
  completedAt: startedAt && ['completed', 'failed', 'cancelled'].includes(status) ? new Date(startedAt.getTime() + 18_000) : null,
  diagnostics: null,
});

describe('question paper draft cards', () => {
  const validate = (id: string, position: number, status: 'succeeded' | 'awaiting_approval' = 'succeeded'): AssistantItemDto =>
    call(id, position, { toolName: 'school.validateQuestionPaperDraft', title: 'Validate a question paper draft' }, status);

  it('shows a succeeded draft check as a card that stays visible when the turn folds', () => {
    const rows = buildAssistantTimeline(
      [user('u', 1), call('a', 2), validate('d1', 3), reply('answer', 4, 'Here is the draft')],
      [run('r1', 'completed', at)],
    );
    expect(rows.map((row) => row.kind)).toEqual(['user', 'work', 'card', 'reply']);
    expect(rows[2]).toMatchObject({ kind: 'card', card: 'question_paper_draft', call: { id: 'd1' } });
    // The read before it is folded away, as ever.
    expect(rows[1]).toMatchObject({ kind: 'work', folded: [{ kind: 'activity' }] });
  });

  it('keeps several drafts as several cards, in order, and does not group them with other reads', () => {
    const rows = buildAssistantTimeline([user('u', 1), validate('d1', 2), call('a', 3), validate('d2', 4)], [run('r1', 'running', at)]);
    expect(rows.map((row) => row.kind)).toEqual(['user', 'work', 'card', 'activity', 'card', 'live']);
    expect(rows.filter((row) => row.kind === 'card').map((row) => row.id)).toEqual(['d1', 'd2']);
  });

  it('shows no card for a check that failed or other question paper tools', () => {
    const failed = { ...validate('d1', 2), status: 'failed' } as AssistantItemDto;
    const save = call('s', 3, { toolName: 'school.saveQuestionPaperVersion', access: 'write' });
    const rows = buildAssistantTimeline([user('u', 1), failed, save], [run('r1', 'running', at)]);
    expect(rows.some((row) => row.kind === 'card')).toBe(false);
  });
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

describe('try again', () => {
  const asked = (id: string, position: number, runId: string, text: string): AssistantItemDto => ({
    ...base, id, position, runId, kind: 'user_message', status: 'complete', body: { text },
  });
  const notices = (items: AssistantItemDto[], runs: AssistantRunDto[]) =>
    buildAssistantTimeline(items, runs).flatMap((row) => (row.kind === 'notice' ? [[row.run.id, row.retryText]] : []));

  it('offers the latest failed or stopped turn its own question again', () => {
    const items = [asked('u1', 1, 'r1', 'First'), asked('u2', 2, 'r2', 'Second')];
    expect(notices(items, [run('r1', 'failed'), run('r2', 'failed')])).toEqual([['r1', null], ['r2', 'Second']]);
    expect(notices(items, [run('r1', 'completed'), run('r2', 'cancelled', at)])).toEqual([['r2', 'Second']]);
  });

  it('offers nothing for a queued message the user removed before it started', () => {
    const items = [asked('u1', 1, 'r1', 'First'), asked('u2', 2, 'r2', 'Second')];
    expect(notices(items, [run('r1', 'completed'), run('r2', 'cancelled')])).toEqual([['r2', null]]);
  });

  it('offers nothing once the conversation has moved on', () => {
    const items = [asked('u1', 1, 'r1', 'First'), asked('u2', 2, 'r2', 'Second')];
    expect(notices(items, [run('r1', 'failed'), run('r2', 'completed')])).toEqual([['r1', null]]);
  });

  it('offers nothing while a turn is working, waiting for approval or queued', () => {
    const items = [asked('u1', 1, 'r1', 'First'), asked('u2', 2, 'r2', 'Second')];
    for (const status of ['running', 'awaiting_approval', 'queued'] as const) {
      expect(notices(items, [run('r1', 'failed'), run('r2', status, at)])).toEqual([['r1', null]]);
    }
  });

  it('picks the newest turn by when it was asked, not by list order', () => {
    const older = { ...run('r1', 'failed'), createdAt: new Date(at.getTime() - 60_000) };
    const items = [asked('u1', 1, 'r1', 'First'), asked('u2', 2, 'r2', 'Second')];
    expect(notices(items, [run('r2', 'failed'), older])).toEqual([['r1', null], ['r2', 'Second']]);
  });
});

describe('stopping', () => {
  const stopRequested = (id: string, status: AssistantRunDto['status'], startedAt: Date | null = at): AssistantRunDto => ({
    ...run(id, status, startedAt), stopRequestedAt: at,
  });

  it('marks a working turn that was asked to stop, until it has ended', () => {
    expect(buildAssistantTimeline([user('u', 1)], [stopRequested('r1', 'running')])[1]).toMatchObject({ kind: 'work', stopRequested: true });
    expect(buildAssistantTimeline([user('u', 1)], [run('r1', 'running', at)])[1]).toMatchObject({ kind: 'work', stopRequested: false });
    expect(buildAssistantTimeline([user('u', 1), reply('a', 2, 'x')], [stopRequested('r1', 'cancelled')])[1]).toMatchObject({
      kind: 'work', state: 'stopped', stopRequested: false,
    });
  });

  it('takes a removed queued message out of the queue at once', () => {
    const items = [user('u1', 1), user('u2', 2, 'r2'), user('u3', 3, 'r3')];
    const runs = [run('r1', 'running', at), stopRequested('r2', 'queued', null), run('r3', 'queued')];
    expect(queuedMessages(items, runs).map((item) => item.id)).toEqual(['u3']);
    // It is not shown in the conversation either, until its run has ended as stopped.
    expect(buildAssistantTimeline(items, runs).map((row) => row.id)).toEqual(['u1', 'work:r1', 'live:r1']);
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

describe('assistantAnnouncement', () => {
  const answer = (sequence: number): AssistantItemDto => ({ ...reply('answer', 3, 'All 18 are registered.'), sequence });

  it('says nothing while a turn works, then reads the finished answer', () => {
    const items = [user('u', 1), answer(5)];
    expect(assistantAnnouncement(items, [run('r1', 'running', at)], 2)).toBe('');
    expect(assistantAnnouncement(items, [run('r1', 'completed', at)], 2)).toBe('Assistant replied: All 18 are registered.');
  });

  it('does not read answers that were there when the conversation was opened', () => {
    expect(assistantAnnouncement([user('u', 1), answer(5)], [run('r1', 'completed', at)], 5)).toBe('');
  });

  it('names a change that waits for a decision, ahead of anything else', () => {
    const waiting = call('w', 2, { access: 'write', approvalId: 'ap', title: 'Rename UKG' }, 'awaiting_approval');
    expect(assistantAnnouncement([user('u', 1), waiting], [run('r1', 'awaiting_approval', at)], 0)).toBe('Approval needed: Rename UKG');
  });

  it('keeps the last answer while a follow-up waits in the queue', () => {
    const items = [user('u', 1), answer(5), user('next', 4, 'r2')];
    expect(assistantAnnouncement(items, [run('r1', 'completed', at), run('r2', 'queued')], 2)).toBe(
      'Assistant replied: All 18 are registered.',
    );
  });
});

describe('approvalsByDecider', () => {
  const asking = (id: string, runId: string): AssistantItemDto => ({ ...call(id, 2, {}, 'awaiting_approval'), runId });
  const sentBy = (id: string, runId: string, author: { userId: string; name: string } | undefined): AssistantItemDto => {
    const item = user(id, 1, runId);
    return item.kind === 'user_message' ? { ...item, body: { ...item.body, ...(author ? { author } : {}) } } : item;
  };
  const items = [sentBy('m1', 'r1', { userId: 'me', name: 'Asha' }), asking('c1', 'r1'), sentBy('m2', 'r2', { userId: 'ravi', name: 'Ravi Kumar' }), asking('c2', 'r2')];
  const runs = [{ ...run('r1', 'awaiting_approval'), userId: 'me' }, { ...run('r2', 'awaiting_approval'), userId: 'ravi' }];

  it('keeps the user’s own changes to decide and names whose decision the others wait for', () => {
    const split = approvalsByDecider(items, runs, 'me');
    expect(split.mine.map((item) => item.id)).toEqual(['c1']);
    expect(split.waitingFor).toEqual(['Ravi Kumar']);
  });

  it('treats a change as the user’s own until it is known whose turn asked for it', () => {
    expect(approvalsByDecider(items, runs, null).mine.map((item) => item.id)).toEqual(['c1', 'c2']);
    expect(approvalsByDecider(items, [], 'me').waitingFor).toEqual([]);
  });

  it('says “someone else” for a turn whose message does not name its sender', () => {
    const unnamed = [sentBy('m2', 'r2', undefined), asking('c2', 'r2')];
    expect(approvalsByDecider(unnamed, runs, 'me').waitingFor).toEqual(['someone else']);
  });
});
