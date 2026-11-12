import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  applyPageOrder,
  continueInChatHref,
  currentJobFailure,
  generatedVersionReady,
  detailPollInterval,
  isConflict,
  resolveSection,
  resolveVersionNo,
  runInOrder,
  uploadsInFlight,
} from './question-paper-model';

const scope = { schoolId: 'sch 1', sessionId: 'ses_1', examSlug: 'half-yearly', classId: 'cls_1', subjectSlug: 'science', modeSlug: 'theory' };

test('the section follows the URL, else the result when a version exists', () => {
  assert.equal(resolveSection('versions', false), 'versions');
  assert.equal(resolveSection(undefined, true), 'result');
  assert.equal(resolveSection(null, false), 'pages');
  assert.equal(resolveSection('nonsense', true), 'result');
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

test('the chat link carries only ids and slugs, encoded', () => {
  assert.equal(
    continueInChatHref(scope),
    '/school/sch%201/assistant?seed=question_paper&sessionId=ses_1&examSlug=half-yearly&classId=cls_1&subjectSlug=science&modeSlug=theory',
  );
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
