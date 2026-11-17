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
  runWithConcurrency,
  pagePreviewFallback,
  pageTurnBlockedReason,
  pagesNotReadyReason,
  pagesProcessing,
  patchStoredPage,
  releaseFailedUpload,
  unreservedUploads,
  scrollAfterZoom,
  turnedRotation,
  uploadsInFlight,
} from './question-paper-model';
import { QueryClient } from '@tanstack/react-query';

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

const page = (position: number, uploadStatus: 'awaiting' | 'stored', derivativeStatus: string) => ({ position, uploadStatus, derivativeStatus });

test('the detail is polled while a job is in flight or a photo is processed, faster for photos', () => {
  const ready = [page(1, 'stored', 'ready')];
  assert.equal(detailPollInterval(undefined), false);
  assert.equal(detailPollInterval({ activeJob: null, pages: ready }), false);
  assert.equal(detailPollInterval({ activeJob: { id: 'j' }, pages: ready }), 3000);
  assert.equal(detailPollInterval({ activeJob: null, pages: [...ready, page(2, 'stored', 'pending')] }), 1000);
  // A reservation whose photo has not arrived is waited for by its upload, not by polling.
  assert.equal(detailPollInterval({ activeJob: null, pages: [page(1, 'awaiting', 'pending')] }), false);
});

test('pages are ready only when every photo arrived and was processed; a failure is named first', () => {
  assert.equal(pagesNotReadyReason([]), null);
  assert.equal(pagesNotReadyReason([page(1, 'stored', 'ready'), page(2, 'stored', 'unsupported')]), null);
  assert.equal(pagesNotReadyReason([page(1, 'stored', 'pending')]), 'Preparing the photos…');
  assert.match(pagesNotReadyReason([page(1, 'stored', 'ready'), page(2, 'awaiting', 'pending')])!, /Page 2 is still uploading/);
  assert.match(pagesNotReadyReason([page(1, 'awaiting', 'pending'), page(2, 'stored', 'failed')])!, /Page 2 could not be read/);
  assert.equal(pagesProcessing([page(1, 'awaiting', 'pending')]), false);
  assert.equal(pagesProcessing([page(1, 'stored', 'pending')]), true);
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

test('uploads start in order, at most the limit at once, and a failure does not stop the rest', async () => {
  const log: string[] = [];
  let running = 0;
  let peak = 0;
  await runWithConcurrency(['a', 'b', 'c', 'd', 'e'], 3, async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    log.push(`start ${item}`);
    await new Promise((resolve) => setTimeout(resolve, item === 'a' ? 20 : 2));
    running -= 1;
    log.push(`end ${item}`);
    if (item === 'b') throw new Error('upload failed');
  });
  assert.equal(peak, 3);
  assert.deepEqual(log.filter((line) => line.startsWith('start')), ['start a', 'start b', 'start c', 'start d', 'start e']);
  assert.equal(log.filter((line) => line.startsWith('end')).length, 5);
  // The slow first photo finishes last: order of completion is free, the pages were reserved in order.
  assert.equal(log.at(-1), 'end a');
});

test('only photos without a reserved page are added to the page count', () => {
  assert.equal(unreservedUploads([{ status: 'converting' }, { status: 'uploading', pageId: 'qpg_1' }, { status: 'error' }]), 1);
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

test('a stored page patched into the cache survives a read of the paper that was already in flight', async () => {
  const queryClient = new QueryClient();
  const queryKey = ['detail'];
  queryClient.setQueryData(queryKey, { pages: [{ id: 'B', uploadStatus: 'awaiting' }] });
  // The processing poll left before B was stored, so it answers with B still awaiting.
  const poll = queryClient
    .fetchQuery({ queryKey, staleTime: 0, queryFn: () => new Promise((resolve) => setTimeout(() => resolve({ pages: [{ id: 'B', uploadStatus: 'awaiting' }] }), 20)) })
    .catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await patchStoredPage(queryClient, queryKey, { id: 'B', uploadStatus: 'stored' });
  await poll;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(queryClient.getQueryData(queryKey), { pages: [{ id: 'B', uploadStatus: 'stored' }] });
  queryClient.clear();
});

test('a failed upload whose page turns out to hold its photo is reported as stored, not missing', async () => {
  assert.equal(await releaseFailedUpload(async () => ({ released: true })), 'released');
  // The store committed and only its answer was lost: the release says the page already has its photo.
  assert.equal(await releaseFailedUpload(async () => Promise.reject(Object.assign(new Error('This page already has its photo.'), { code: 'CONFLICT' }))), 'stored');
  // Any other failure of the release leaves the photo reported as not added (the server sweeps the page).
  assert.equal(await releaseFailedUpload(async () => Promise.reject(new Error('Unable to reach the server.'))), 'released');
});

test('the page preview says the AI can read a photo only when it was stored and is merely undrawable', () => {
  assert.equal(pagePreviewFallback({ uploadStatus: 'stored', derivativeStatus: 'unsupported' }), 'This photo cannot be shown here. The AI can still read it.');
  assert.equal(pagePreviewFallback({ uploadStatus: 'stored', derivativeStatus: 'failed' }), 'This photo could not be read. Remove the page and add the photo again.');
  assert.equal(pagePreviewFallback({ uploadStatus: 'awaiting', derivativeStatus: 'pending' }), 'This photo has not arrived. Remove the page and add the photo again.');
});

test('a page can be turned only once its copies exist, and the viewer says why not before that', () => {
  assert.equal(pageTurnBlockedReason({ uploadStatus: 'stored', derivativeStatus: 'ready' }), null);
  assert.equal(pageTurnBlockedReason({ uploadStatus: 'awaiting', derivativeStatus: 'pending' }), 'This photo is still uploading.');
  assert.equal(pageTurnBlockedReason({ uploadStatus: 'stored', derivativeStatus: 'pending' }), 'This photo is still being prepared.');
  assert.equal(pageTurnBlockedReason({ uploadStatus: 'stored', derivativeStatus: 'failed' }), 'This photo could not be read.');
  assert.equal(pageTurnBlockedReason({ uploadStatus: 'stored', derivativeStatus: 'unsupported' }), "This photo's format cannot be turned.");
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
