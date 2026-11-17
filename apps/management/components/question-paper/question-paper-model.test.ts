import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  applyPageOrder,
  assistantCollapsedOf,
  canCompareOf,
  compareAsked,
  comparePageIndex,
  currentJobFailure,
  generatedVersionReady,
  detailPollInterval,
  isConflict,
  chatIdOf,
  paperChatOf,
  hasStudioOf,
  draftIsNewest,
  resolveView,
  resolveVersionNo,
  shownPaperOf,
  runInOrder,
  scrollAfterZoom,
  turnedRotation,
  uploadsInFlight,
} from './question-paper-model';

const scope = { schoolId: 'sch 1', sessionId: 'ses_1', examSlug: 'half-yearly', classId: 'cls_1', subjectSlug: 'science', modeSlug: 'theory' };

const nothing = { start: null, hasVersion: false, generating: false, hasChat: false };

test('a paper with nothing shows its first screen, and the address can ask for it', () => {
  assert.deepEqual(resolveView(nothing), { kind: 'start', picking: false });
  assert.deepEqual(resolveView({ ...nothing, start: 'earlier' }), { kind: 'start', picking: true });
  // Also for a paper that already has versions: adding photos or copying again is asked for in the address.
  assert.deepEqual(resolveView({ ...nothing, start: 'sources', hasVersion: true }), { kind: 'start', picking: false });
  assert.deepEqual(resolveView({ ...nothing, start: 'earlier', hasVersion: true }), { kind: 'start', picking: true });
  assert.deepEqual(resolveView({ ...nothing, start: 'nonsense' }), { kind: 'start', picking: false });
  assert.deepEqual(resolveView({ ...nothing, start: 'nonsense', hasVersion: true }), { kind: 'studio' });
});

test('the studio shows once there is a version, a generation at work or a conversation', () => {
  assert.deepEqual(resolveView({ ...nothing, hasVersion: true }), { kind: 'studio' });
  assert.deepEqual(resolveView({ ...nothing, generating: true }), { kind: 'studio' });
  assert.deepEqual(resolveView({ ...nothing, hasChat: true }), { kind: 'studio' });
});

test('only the assistant\'s own conversation ids are read from the address', () => {
  assert.equal(chatIdOf('asc_1zha8rfad562u25ztsr16'), 'asc_1zha8rfad562u25ztsr16');
  assert.equal(chatIdOf('../../etc'), null);
  assert.equal(chatIdOf(''), null);
  assert.equal(chatIdOf(null), null);
});

test('the version follows the URL when it exists, else the latest', () => {
  assert.equal(resolveVersionNo('2', [3, 2, 1]), 2);
  assert.equal(resolveVersionNo('9', [3, 2, 1]), 3);
  assert.equal(resolveVersionNo('1.5', [3, 2, 1]), 3);
  assert.equal(resolveVersionNo(undefined, [3, 2, 1]), 3);
  assert.equal(resolveVersionNo('1', []), null);
});

test('the detail is polled only while a job is in flight', () => {
  assert.equal(detailPollInterval(undefined), false);
  assert.equal(detailPollInterval({ activeJob: null }), false);
  assert.equal(detailPollInterval({ activeJob: { id: 'j' } }), 3000);
});

test('the paper side shows a named version, else the unsaved draft, else the latest version', () => {
  assert.deepEqual(shownPaperOf(null, [1, 2], true), { kind: 'draft' });
  assert.deepEqual(shownPaperOf('1', [1, 2], true), { kind: 'version', versionNo: 1 });
  assert.deepEqual(shownPaperOf(null, [1, 2], false), { kind: 'version', versionNo: 2 });
  // A version that does not exist falls back to the latest; with no version at all, to the draft.
  assert.deepEqual(shownPaperOf('9', [1, 2], true), { kind: 'version', versionNo: 2 });
  assert.deepEqual(shownPaperOf('9', [], true), { kind: 'draft' });
  assert.deepEqual(shownPaperOf(null, [], false), { kind: 'nothing' });
});

test('an optimistic reorder renumbers and never drops a page', () => {
  const pages = [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'c', position: 3 }];
  assert.deepEqual(applyPageOrder(pages, ['c', 'a', 'b']), [{ id: 'c', position: 1 }, { id: 'a', position: 2 }, { id: 'b', position: 3 }]);
  assert.deepEqual(applyPageOrder(pages, ['b', 'zz']).map((page) => page.id), ['b', 'a', 'c']);
  assert.deepEqual(pages.map((page) => page.position), [1, 2, 3]);
});

test('conflicts are recognised by code', () => {
  assert.equal(isConflict({ code: 'CONFLICT' }), true);
  assert.equal(isConflict({ code: 'BAD_REQUEST' }), false);
  assert.equal(isConflict(new Error('x')), false);
  assert.equal(isConflict(null), false);
});

test('uploads run one after another in the order given, even after a failure', async () => {
  const log: string[] = [];
  await runInOrder(['a', 'b', 'c'], async (item) => {
    log.push(`start ${item}`);
    await new Promise((resolve) => setTimeout(resolve, item === 'a' ? 15 : 1));
    log.push(`end ${item}`);
  });
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
});

test('photos on their way count as in flight, a failed one does not', () => {
  assert.equal(uploadsInFlight([]), 0);
  assert.equal(uploadsInFlight([{ status: 'converting' }, { status: 'uploading' }, { status: 'error' }]), 2);
  assert.equal(uploadsInFlight([{ status: 'error' }]), 0);
});

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 10, minute));
const job = (status: 'succeeded' | 'failed') => ({ id: 'job1', status, errorCode: status === 'failed' ? 'model_busy' : null, errorMessage: 'Try later.', createdAt: at(0), completedAt: at(5) });

test('a failure is news only until a newer version exists', () => {
  assert.deepEqual(currentJobFailure({ lastFinishedJob: job('failed'), versions: [] }), { errorCode: 'model_busy', message: 'Try later.' });
  assert.equal(currentJobFailure({ lastFinishedJob: job('failed'), versions: [{ versionNo: 1, createdAt: at(9), sourceJobId: null }] }), null);
  assert.equal(currentJobFailure({ lastFinishedJob: job('succeeded'), versions: [] }), null);
});

test('the version a succeeded job produced is announced while it is the newest', () => {
  const own = { versionNo: 3, createdAt: at(4), sourceJobId: 'job1' };
  assert.equal(generatedVersionReady({ lastFinishedJob: job('succeeded'), versions: [own] }), 3);
  // A version saved in chat afterwards, or by another job, is not this job's news.
  assert.equal(generatedVersionReady({ lastFinishedJob: job('succeeded'), versions: [{ versionNo: 4, createdAt: at(99), sourceJobId: null }, own] }), null);
  assert.equal(generatedVersionReady({ lastFinishedJob: job('succeeded'), versions: [{ ...own, sourceJobId: 'job0' }] }), null);
  assert.equal(generatedVersionReady({ lastFinishedJob: job('failed'), versions: [own] }), null);
  assert.equal(generatedVersionReady({ lastFinishedJob: null, versions: [] }), null);
});

test('the paper conversation: the one the address names, none when it asks for a new one, else the latest', () => {
  const latest = 'asc_latest0000000000001';
  assert.equal(paperChatOf('asc_named00000000000001', latest), 'asc_named00000000000001');
  assert.equal(paperChatOf('new', latest), null);
  assert.equal(paperChatOf(null, latest), latest);
  assert.equal(paperChatOf(null, null), null);
  // Something that is not an id falls back to the latest, never reaches a request.
  assert.equal(paperChatOf('../etc', latest), latest);
});

test('the first screen has a way back while the paper has any conversation, also after New chat on a paper with no version', () => {
  const none = { hasVersion: false, generating: false, chatId: null, latestConversationId: null };
  assert.equal(hasStudioOf(none), false);
  assert.equal(hasStudioOf({ ...none, latestConversationId: 'asc_latest0000000000001' }), true);
  assert.equal(hasStudioOf({ ...none, hasVersion: true }), true);
  assert.equal(hasStudioOf({ ...none, generating: true }), true);
});

test('an unsaved draft is shown only while no version was saved after it', () => {
  const draftAt = new Date('2026-11-14T10:00:00Z');
  assert.equal(draftIsNewest(draftAt, []), true);
  assert.equal(draftIsNewest(draftAt, [{ createdAt: new Date('2026-11-14T09:00:00Z') }]), true);
  // The photo job (or another chat) saved a version after the draft was written.
  assert.equal(draftIsNewest(draftAt, [{ createdAt: new Date('2026-11-14T11:00:00Z') }, { createdAt: new Date('2026-11-14T09:00:00Z') }]), false);
  assert.equal(draftIsNewest(draftAt, [{ createdAt: draftAt }]), false);
});

test('Rotate right turns a page a quarter clockwise and Rotate left a quarter back, wrapping at a full turn', () => {
  const rotations = [0, 90, 180, 270] as const;
  assert.deepEqual(rotations.map((rotation) => turnedRotation(rotation, 'right')), [90, 180, 270, 0]);
  assert.deepEqual(rotations.map((rotation) => turnedRotation(rotation, 'left')), [270, 0, 90, 180]);
  for (const rotation of rotations) assert.equal(turnedRotation(turnedRotation(rotation, 'right'), 'left'), rotation);
});

test('comparing with the photos is asked for by ?compare=1 only', () => {
  assert.equal(compareAsked('1'), true);
  for (const raw of [null, undefined, '', '0', 'true', 'yes', '2']) assert.equal(compareAsked(raw), false);
});

test('a paper can be compared only when it has photos and a paper on screen', () => {
  assert.equal(canCompareOf({ pageCount: 3, shown: { kind: 'version', versionNo: 2 } }), true);
  assert.equal(canCompareOf({ pageCount: 1, shown: { kind: 'draft' } }), true);
  // Made in chat or copied from an earlier paper: nothing was photographed.
  assert.equal(canCompareOf({ pageCount: 0, shown: { kind: 'version', versionNo: 1 } }), false);
  // Photos whose first paper is still being generated: nothing to read against them yet.
  assert.equal(canCompareOf({ pageCount: 3, shown: { kind: 'nothing' } }), false);
});

test('the assistant folds away while comparing and is as it was left afterwards', () => {
  const open = { collapsed: false, shownWhileComparing: false };
  assert.equal(assistantCollapsedOf({ ...open, comparing: false }), false);
  assert.equal(assistantCollapsedOf({ ...open, comparing: true }), true);
  // Opened again during the comparison: it stays open, and that says nothing about how it is left afterwards.
  assert.equal(assistantCollapsedOf({ collapsed: true, shownWhileComparing: true, comparing: true }), false);
  assert.equal(assistantCollapsedOf({ collapsed: true, shownWhileComparing: true, comparing: false }), true);
  assert.equal(assistantCollapsedOf({ collapsed: true, shownWhileComparing: false, comparing: false }), true);
});

test('the comparison shows the page stepped to, and the first when it is gone or none was chosen', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(comparePageIndex(ids, null), 0);
  assert.equal(comparePageIndex(ids, 'c'), 2);
  assert.equal(comparePageIndex(ids, 'removed'), 0);
  assert.equal(comparePageIndex([], 'a'), -1);
  assert.equal(comparePageIndex([], null), -1);
});

test('zooming keeps the point under the pointer where it was', () => {
  // Fitted page, pressed 100 px in and 300 px down: at twice the size that point is at (200, 600), so the pane scrolls by the difference.
  assert.deepEqual(scrollAfterZoom({ x: 0, y: 0 }, { x: 100, y: 300 }, 2), { x: 100, y: 300 });
  // Already scrolled down the fitted page.
  assert.deepEqual(scrollAfterZoom({ x: 0, y: 400 }, { x: 100, y: 300 }, 2), { x: 100, y: 1100 });
  // Zooming out is the inverse, so in and out returns to where it started.
  assert.deepEqual(scrollAfterZoom({ x: 100, y: 1100 }, { x: 100, y: 300 }, 0.5), { x: 0, y: 400 });
});
