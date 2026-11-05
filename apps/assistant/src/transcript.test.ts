import { describe, expect, it } from 'vitest';

import { toModelToolName } from './runtime/tools';
import { buildUserTranscriptContent, modelTranscriptKey, toolResultsTranscriptKey } from './transcript';

describe('transcript', () => {
  it('keeps the page context apart from what the user asked', () => {
    expect(
      buildUserTranscriptContent({ text: 'Who is this?', pageContext: { path: '/school/s/admission/a', title: 'Riya' } }),
    ).toEqual([
      { type: 'text', text: '<current_page>\nPath: /school/s/admission/a\nTitle: Riya\n</current_page>' },
      { type: 'text', text: 'Who is this?' },
    ]);
    expect(buildUserTranscriptContent({ text: 'Hi' })).toEqual([{ type: 'text', text: 'Hi' }]);
  });

  it('keys every step of a run distinctly', () => {
    expect(modelTranscriptKey('r', 0)).not.toBe(toolResultsTranscriptKey('r', 0));
    expect(modelTranscriptKey('r', 0)).not.toBe(modelTranscriptKey('r', 1));
  });

  it('maps MCP tool names to Claude API names', () => {
    expect(toModelToolName('school.listStudents')).toBe('school_listStudents');
  });
});
