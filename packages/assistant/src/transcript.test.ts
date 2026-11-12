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

  it('stores attachments as markers in order, before the text, and never as bytes', () => {
    const attachment = (id: string, fileName: string) => ({ id, fileName, contentType: 'image/jpeg', byteSize: 10, width: 1, height: 1, previewable: true });
    expect(
      buildUserTranscriptContent({
        text: 'Make a paper',
        pageContext: { path: '/school/s/assistant' },
        attachments: [attachment('asat_1', 'page1.jpg'), attachment('asat_2', 'page2.jpg')],
      }),
    ).toEqual([
      { type: 'text', text: '<current_page>\nPath: /school/s/assistant\n</current_page>' },
      { type: 'campuspilot_attachment', attachmentId: 'asat_1', fileName: 'page1.jpg', contentType: 'image/jpeg', ordinal: 1, total: 2 },
      { type: 'campuspilot_attachment', attachmentId: 'asat_2', fileName: 'page2.jpg', contentType: 'image/jpeg', ordinal: 2, total: 2 },
      { type: 'text', text: 'Make a paper' },
    ]);
    // Images only: no empty text block, which providers reject.
    expect(buildUserTranscriptContent({ text: '', attachments: [attachment('asat_1', 'a.jpg')] })).toHaveLength(1);
  });

  it('tells the model which paper a seeded conversation is about, by natural key only', () => {
    const blocks = buildUserTranscriptContent({
      text: 'I want to update this question paper: add a question',
      seed: { kind: 'question_paper', sessionId: 'ss1', examSlug: 'half-yearly', classId: 'cl1', subjectSlug: 'science', modeSlug: 'theory' },
    });
    expect(blocks).toHaveLength(2);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('<question_paper_context>');
    expect(text).toContain('exam: half-yearly; class: cl1; subject: science; mode: theory; session: ss1');
    expect(text).toContain('getQuestionPaper');
  });

  it('keys every step of a run distinctly', () => {
    expect(modelTranscriptKey('r', 0)).not.toBe(toolResultsTranscriptKey('r', 0));
    expect(modelTranscriptKey('r', 0)).not.toBe(modelTranscriptKey('r', 1));
  });

  it('maps MCP tool names to model tool names', () => {
    expect(toModelToolName('school.listStudents')).toBe('school_listStudents');
  });
});
