import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssistantAttachmentRef } from '@campuspilot/assistant-contract/attachments';

import {
  createPlanOf,
  describedPaperMessage,
  MIXED_SOURCE_REASON,
  marksMismatchOf,
  noteWordsOf,
  pdfPaperMessage,
  REFUSED_TYPE_REASON,
  WORD_FILE_REASON,
  sortSourcePicks,
  START_NOTE_MAX_LENGTH,
  type AlternativeSource,
  type EarlierPaper,
  type PdfSource,
} from './question-paper-start-model';

const photo = (name: string) => ({ name, type: 'image/jpeg', size: 1000 });
const pdfFile = (name: string) => ({ name, type: 'application/pdf', size: 1000 });
const word = { name: 'paper.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1000 };

const ref: AssistantAttachmentRef = { id: 'asat_1', kind: 'document', fileName: 'old.pdf', contentType: 'application/pdf', byteSize: 1000, width: null, height: null, previewable: false };
const readyPdf: PdfSource = { fileName: 'old.pdf', byteSize: 1000, status: 'ready', attachment: ref, error: null };
const earlier: EarlierPaper = {
  key: { schoolId: 'sch_1', sessionId: 'ses_0', examSlug: 'half-yearly', classId: 'cls_1', subjectSlug: 'science', modeSlug: 'theory' },
  versionNo: 2,
  examName: 'Half-Yearly',
  sessionLabel: '2025-26',
  modeName: 'Theory',
  savedAt: new Date('2026-10-12T00:00:00Z'),
  planMaxMarks: 80,
};
const withPdf: AlternativeSource = { kind: 'pdf', pdf: readyPdf };
const withEarlier: AlternativeSource = { kind: 'earlier', earlier };
const nothing = { alternative: null, pageCount: 0, uploading: false, note: '' };

test('photos join the paper and one PDF becomes the source', () => {
  assert.deepEqual(sortSourcePicks([photo('a.jpg'), photo('b.jpg')], { alternative: null, photoCount: 0 }), { photos: [photo('a.jpg'), photo('b.jpg')], pdf: null, refused: [] });
  assert.deepEqual(sortSourcePicks([pdfFile('old.pdf')], { alternative: null, photoCount: 0 }), { photos: [], pdf: pdfFile('old.pdf'), refused: [] });
});

test('a file that is neither is refused with what to do, and never stops the others', () => {
  const picks = sortSourcePicks([word, photo('a.jpg')], { alternative: null, photoCount: 0 });
  assert.deepEqual(picks.photos, [photo('a.jpg')]);
  assert.deepEqual(picks.refused, [{ name: 'paper.docx', reason: WORD_FILE_REASON }]);
  assert.match(WORD_FILE_REASON, /Save it as a PDF/);
  // Anything else gets the general sentence, without a list of formats.
  assert.deepEqual(sortSourcePicks([{ name: 'marks.xlsx', type: 'application/vnd.ms-excel', size: 10 }], { alternative: null, photoCount: 0 }).refused, [{ name: 'marks.xlsx', reason: REFUSED_TYPE_REASON }]);
});

test('photos and a PDF never mix, whichever came first', () => {
  // Photos already on the paper, or in the same pick: the PDF is refused.
  for (const picks of [
    sortSourcePicks([pdfFile('old.pdf')], { alternative: null, photoCount: 3 }),
    sortSourcePicks([photo('a.jpg'), pdfFile('old.pdf')], { alternative: null, photoCount: 0 }),
  ]) {
    assert.equal(picks.pdf, null);
    assert.equal(picks.refused.length, 1);
    assert.ok(picks.refused[0]!.reason.startsWith(MIXED_SOURCE_REASON));
  }
  // A PDF or an earlier paper is the source: photos are refused, and say which to remove.
  assert.match(sortSourcePicks([photo('a.jpg')], { alternative: withPdf, photoCount: 0 }).refused[0]!.reason, /Remove the PDF/);
  assert.match(sortSourcePicks([photo('a.jpg')], { alternative: withEarlier, photoCount: 0 }).refused[0]!.reason, /Remove the earlier paper/);
  assert.match(sortSourcePicks([pdfFile('b.pdf')], { alternative: withEarlier, photoCount: 0 }).refused[0]!.reason, /Remove the earlier paper/);
});

test('only one PDF is taken', () => {
  const two = sortSourcePicks([pdfFile('a.pdf'), pdfFile('b.pdf')], { alternative: null, photoCount: 0 });
  assert.deepEqual(two.pdf, pdfFile('a.pdf'));
  assert.match(two.refused[0]!.reason, /Only one PDF/);
  assert.match(sortSourcePicks([pdfFile('b.pdf')], { alternative: withPdf, photoCount: 0 }).refused[0]!.reason, /Only one PDF/);
});

test('an empty card creates nothing and says nothing', () => {
  assert.deepEqual(createPlanOf(nothing), { kind: 'blocked', reason: null });
  assert.deepEqual(createPlanOf({ ...nothing, note: '   ' }), { kind: 'blocked', reason: null });
});

test('photos go to the generation job, with the note as its instructions', () => {
  assert.deepEqual(createPlanOf({ ...nothing, pageCount: 4 }), { kind: 'generate', instructions: null });
  assert.deepEqual(createPlanOf({ ...nothing, pageCount: 4, note: ' Change the numbers. ' }), { kind: 'generate', instructions: 'Change the numbers.' });
  // The job's own limit is shorter than a description's.
  assert.deepEqual(createPlanOf({ ...nothing, pageCount: 4, note: 'x'.repeat(2001) }), { kind: 'blocked', reason: 'Keep the instructions under 2,000 characters.' });
  assert.equal(createPlanOf({ ...nothing, note: 'x'.repeat(2001) }).kind, 'assistant');
  // Photos still on their way would be left out of the job.
  assert.deepEqual(createPlanOf({ ...nothing, pageCount: 4, uploading: true }), { kind: 'blocked', reason: 'The photos are still uploading.' });
});

test('a note alone is a description for the assistant', () => {
  assert.deepEqual(createPlanOf({ ...nothing, note: 'Chapters 4 to 6' }), { kind: 'assistant', message: describedPaperMessage('Chapters 4 to 6'), attachments: [] });
});

test('a PDF goes to the assistant as the first message, once it is stored', () => {
  assert.deepEqual(createPlanOf({ ...nothing, alternative: withPdf }), { kind: 'assistant', message: pdfPaperMessage('old.pdf', ''), attachments: [ref] });
  assert.match(pdfPaperMessage('old.pdf', ''), /do not add or remove questions/);
  assert.match(pdfPaperMessage('old.pdf', 'Make it easier'), /My instructions:\nMake it easier$/);
  const uploading: AlternativeSource = { kind: 'pdf', pdf: { ...readyPdf, status: 'uploading', attachment: null } };
  const failed: AlternativeSource = { kind: 'pdf', pdf: { ...readyPdf, status: 'failed', attachment: null, error: 'Too large.' } };
  assert.deepEqual(createPlanOf({ ...nothing, alternative: uploading }), { kind: 'blocked', reason: 'The PDF is still uploading.' });
  assert.deepEqual(createPlanOf({ ...nothing, alternative: failed }), { kind: 'blocked', reason: 'Remove the PDF that could not be uploaded.' });
});

test('a chosen source wins over photos already on the paper', () => {
  assert.equal(createPlanOf({ ...nothing, alternative: withPdf, pageCount: 4 }).kind, 'assistant');
  assert.deepEqual(createPlanOf({ ...nothing, alternative: withEarlier, pageCount: 4, uploading: true, note: 'Easier' }), { kind: 'copy', earlier, followUp: 'Easier' });
  assert.deepEqual(createPlanOf({ ...nothing, alternative: withEarlier }), { kind: 'copy', earlier, followUp: null });
});

test('a note that is too long blocks every way of creating', () => {
  const note = 'x'.repeat(START_NOTE_MAX_LENGTH + 1);
  for (const input of [{ ...nothing, note }, { ...nothing, pageCount: 2, note }, { ...nothing, alternative: withEarlier, note }]) {
    assert.equal(createPlanOf(input).kind, 'blocked');
  }
});

test('the note reads as optional once there is a source, and as the way in when there is none', () => {
  assert.equal(noteWordsOf({ alternative: null, hasPhotos: false }).label, 'Or describe the paper');
  for (const input of [{ alternative: null, hasPhotos: true }, { alternative: withPdf, hasPhotos: false }, { alternative: withEarlier, hasPhotos: false }]) {
    assert.equal(noteWordsOf(input).label, 'Instructions (optional)');
  }
});

test('an earlier paper written for other marks is said, and changes the example', () => {
  assert.equal(marksMismatchOf(earlier, 80), null);
  assert.equal(marksMismatchOf({ ...earlier, planMaxMarks: null }, 20), null);
  assert.equal(marksMismatchOf(earlier, 20), 'That paper is for 80 marks and this one is for 20. It is copied as it is unless you say in the instructions what to keep.');
  assert.match(noteWordsOf({ alternative: withEarlier, hasPhotos: false, marksDiffer: true }).placeholder, /section A only/);
});
