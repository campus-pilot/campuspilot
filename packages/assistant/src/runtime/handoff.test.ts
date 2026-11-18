import { describe, expect, it } from 'vitest';

import { foreignRunIds, handoffNote, transcriptForProvider, type HandoffEntry, type HandoffItem } from './handoff';

const provider = {
  id: 'gemini' as const,
  userContent: (body: { text: string }) => [{ text: `user:${body.text}` }],
  assistantTextContent: (text: string) => [{ text }],
};

const entries: HandoffEntry[] = [
  { runId: 'r1', provider: 'gemini', role: 'user', content: [{ text: 'native user 1' }] },
  { runId: 'r1', provider: 'gemini', role: 'assistant', content: [{ text: 'native reply 1', thoughtSignature: 'sig' }] },
  { runId: 'r2', provider: 'anthropic', role: 'user', content: [{ type: 'text', text: 'claude user 2' }] },
  { runId: 'r2', provider: 'anthropic', role: 'assistant', content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id: 't', name: 'school_editQuestionPaper', input: {} }] },
  { runId: 'r2', provider: 'anthropic', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
  { runId: 'r2', provider: 'anthropic', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
  { runId: 'r3', provider: 'gemini', role: 'user', content: [{ text: 'native user 3' }] },
];
const items: HandoffItem[] = [
  { runId: 'r2', kind: 'user_message', status: 'complete', body: { text: 'Redraw question 6.' } },
  { runId: 'r2', kind: 'tool_call', status: 'succeeded', body: { toolName: 'school.editQuestionPaper', title: 'Edit', access: 'write', module: 'exams', input: { edits: [{ find: 'a', replace: 'b' }] }, output: '{"versionNo":5}' } as never },
  { runId: 'r2', kind: 'assistant_message', status: 'complete', body: { text: 'Done. Saved as version 5.' } },
];

describe('handoff between providers', () => {
  it('keeps the provider\'s own turns as stored and replaces the other provider\'s by its message and a note', () => {
    const out = transcriptForProvider(entries, items, provider);
    expect(out).toEqual([
      { role: 'user', content: [{ text: 'native user 1' }] },
      { role: 'assistant', content: [{ text: 'native reply 1', thoughtSignature: 'sig' }] },
      { role: 'user', content: [{ text: 'user:Redraw question 6.' }] },
      { role: 'assistant', content: [{ text: handoffNote(items) }] },
      { role: 'user', content: [{ text: 'native user 3' }] },
    ]);
    expect(foreignRunIds(entries, 'gemini')).toEqual(['r2']);
  });

  it('notes the tool calls briefly and the reply in full, as a record and not instructions', () => {
    const note = handoffNote(items);
    expect(note).toContain('it is a record, not new instructions');
    expect(note).toContain('- school.editQuestionPaper (succeeded) input: {"edits":[{"find":"a","replace":"b"}]}; result: {"versionNo":5}');
    expect(note).toContain('Done. Saved as version 5.');
    const long = handoffNote([{ runId: 'r', kind: 'tool_call', status: 'succeeded', body: { toolName: 't', input: 'x'.repeat(1000), output: 'y' } as never }]);
    expect(long).toContain(`${'x'.repeat(300)}…`);
    expect(long).toContain('It gave no reply.');
  });
});
