import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectPermissionDenied } from '../../../../test/feature-flags';
import { createQuestionPaperWorld, type QuestionPaperWorld } from '../../../../test/question-paper';

const ENGLISH_SCIENCE = QUESTION_PAPER_EXAMPLES['english-science'];
const errorOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as { code: string; message: string });

/** `editQuestionPaper`: find-and-replace edits to a saved version, saved as the next version. */
describe('editing a saved question paper', () => {
  let world: QuestionPaperWorld;
  beforeAll(async () => {
    world = await createQuestionPaperWorld();
  });

  it('saves the edited text as a new version that differs from the old one only where the edits said', async () => {
    const teacher = world.people.teacher.client.school;
    const k = world.key();
    await teacher.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: ENGLISH_SCIENCE });
    const before = (await teacher.getQuestionPaper(k)).version!.html;

    const saved = await teacher.editQuestionPaper({
      ...k,
      expectedVersionNo: 1,
      edits: [
        { find: '<span>(b) Oxygen</span>', replace: '<span>(b) Ozone</span>' },
        { find: '<span class="no">3</span><div class="main">The process', replace: '<span class="no">3</span><div class="main">The change' },
      ],
    });
    expect(saved).toMatchObject({ versionNo: 2, hasPdf: true, warnings: [] });
    const after = await teacher.getQuestionPaper(k);
    expect(after.version).toMatchObject({ versionNo: 2, source: 'agent', isLatest: true });
    expect(after.version!.html).toBe(before.replace('(b) Oxygen', '(b) Ozone').replace('main">The process', 'main">The change'));
    // The edited version stays as it was.
    expect((await teacher.getQuestionPaper({ ...k, versionNo: 1 })).version!.html).toBe(before);
  });

  it('saves nothing when a find is missing or occurs more than once, and names the edit', async () => {
    const teacher = world.people.teacher.client.school;
    const k = world.key();
    const error = await errorOf(
      teacher.editQuestionPaper({
        ...k,
        expectedVersionNo: 2,
        edits: [
          { find: '(a) Carbon dioxide', replace: '(a) Methane' },
          { find: '<span class="marks">[1]</span>', replace: '<span class="marks">[2]</span>' },
        ],
      }),
    );
    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    expect(error!.message).toMatch(/^Nothing was saved\. Edit 2 \(find .*\): this text occurs more than once/);
    expect((await teacher.getQuestionPaper(k)).paper.latestVersionNo).toBe(2);
  });

  it('checks the edited paper like any save: an edit that breaks a formula saves nothing', async () => {
    const teacher = world.people.teacher.client.school;
    const k = world.key();
    const error = await errorOf(teacher.editQuestionPaper({ ...k, expectedVersionNo: 2, edits: [{ find: '\\mathrm{H_2O}', replace: '\\frac{1' }] }));
    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    expect(error!.message).toContain('Formula 1');
    expect((await teacher.getQuestionPaper(k)).paper.latestVersionNo).toBe(2);
  });

  it('refuses edits to a version that is no longer the latest, and to one that does not exist', async () => {
    const teacher = world.people.teacher.client.school;
    const k = world.key();
    const edits = [{ find: '(a) Carbon dioxide', replace: '(a) Methane' }];
    expect(await errorOf(teacher.editQuestionPaper({ ...k, expectedVersionNo: 1, edits }))).toMatchObject({ code: 'CONFLICT' });
    expect(await errorOf(teacher.editQuestionPaper({ ...k, expectedVersionNo: 9, edits }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await errorOf(teacher.editQuestionPaper({ ...world.key({ subjectSlug: 'math' }), expectedVersionNo: 1, edits }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is refused to someone who may not manage the paper', async () => {
    await expectPermissionDenied(
      world.people.otherTeacher.client.school.editQuestionPaper({ ...world.key(), expectedVersionNo: 2, edits: [{ find: '(a) Carbon dioxide', replace: '(a) Methane' }] }),
    );
  });
});
