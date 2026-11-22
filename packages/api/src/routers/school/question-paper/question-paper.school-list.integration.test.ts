import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectPermissionDenied } from '../../../../test/feature-flags';
import { createQuestionPaperWorld, type QuestionPaperWorld } from '../../../../test/question-paper';

/** The Question papers page of a school (docs/question-papers.md "The Question papers page"). */

const { 'english-science': ENGLISH_SCIENCE } = QUESTION_PAPER_EXAMPLES;

describe('the Question papers page', () => {
  let world: QuestionPaperWorld;
  let generatedExam: string;
  let emptyExam: string;
  let generatedQuick: string;
  let draftQuick: string;
  let otherTeachersQuick: string;

  beforeAll(async () => {
    world = await createQuestionPaperWorld();
    const { teacher, otherTeacher, manager } = world.people;
    const { schoolId } = world;
    // An exam paper of the teacher's class with a version, and one with only a page reserved (no version).
    generatedExam = (await manager.client.school.saveQuestionPaperVersion({ ...world.key(), expectedVersionNo: 0, html: ENGLISH_SCIENCE })).paperId;
    await manager.client.school.reserveQuestionPaperPages({ ...world.key({ subjectSlug: 'math', modeSlug: 'theory' }), fileNames: ['page.jpg'] });
    emptyExam = (await manager.client.school.getQuestionPaperDetail(world.key({ subjectSlug: 'math', modeSlug: 'theory' }))).paper.paperId!;
    // Quick papers: one generated, one not yet, and one of another teacher.
    generatedQuick = (await teacher.client.school.createStandalonePaper({ schoolId })).paperId;
    await teacher.client.school.saveStandalonePaperVersion({
      schoolId,
      paperId: generatedQuick,
      expectedVersionNo: 0,
      html: ENGLISH_SCIENCE,
      details: { schoolName: null, className: 'Class 7', subjectName: 'English', examName: 'Unit Test 1', maxMarks: 20 },
    });
    draftQuick = (await teacher.client.school.createStandalonePaper({ schoolId })).paperId;
    await teacher.client.school.reserveStandalonePaperPages({ schoolId, paperId: draftQuick, fileNames: ['page.jpg'] });
    otherTeachersQuick = (await otherTeacher.client.school.createStandalonePaper({ schoolId })).paperId;
  });

  const list = (who: keyof QuestionPaperWorld['people'], filters: Record<string, string> = {}, searchQuery = '') =>
    world.people[who].client.school
      .listSchoolQuestionPapers({ schoolId: world.schoolId, sessionId: world.sessionId, filters, searchQuery })
      .then((page) => page.items.map((item) => item.paperId));

  it('lists every quick paper and only the exam papers that have a version by default, newest first', async () => {
    const ids = await list('principal');
    expect(ids).toEqual(expect.arrayContaining([generatedExam, generatedQuick, draftQuick, otherTeachersQuick]));
    expect(ids).not.toContain(emptyExam);
    const rows = await world.people.principal.client.school.listSchoolQuestionPapers({ schoolId: world.schoolId, sessionId: world.sessionId });
    const updated = rows.items.map((item) => new Date(item.updatedAt).getTime());
    expect(updated).toEqual([...updated].sort((left, right) => right - left));
  });

  it('filters by type and status; not generated yet shows the exam paper without a version', async () => {
    expect(await list('principal', { type: 'exam' })).toEqual([generatedExam]);
    expect(await list('principal', { type: 'exam', status: 'not_generated' })).toEqual([emptyExam]);
    expect(new Set(await list('principal', { type: 'quick', status: 'not_generated' }))).toEqual(new Set([draftQuick, otherTeachersQuick]));
    expect(await list('principal', { type: 'quick', status: 'generated' })).toEqual([generatedQuick]);
  });

  it('names each row and filters and searches by those names', async () => {
    const page = await world.people.principal.client.school.listSchoolQuestionPapers({ schoolId: world.schoolId, sessionId: world.sessionId, filters: { type: 'exam' } });
    expect(page.items[0]).toMatchObject({
      type: 'exam',
      examName: 'Term I Examination',
      className: 'Class 8',
      subjectName: 'Science',
      modeName: 'Theory',
      examKey: { examSlug: 'term-1', classId: world.classId, subjectSlug: 'science', modeSlug: 'theory' },
    });
    expect(await list('principal', { subjectName: 'English' })).toEqual([generatedQuick]);
    expect(await list('principal', {}, 'unit test')).toEqual([generatedQuick]);
    const options = await world.people.principal.client.school.listSchoolQuestionPaperFilterOptions({ schoolId: world.schoolId, sessionId: world.sessionId });
    expect(options.subjectNames).toEqual(expect.arrayContaining(['English', 'Mathematics', 'Science']));
    expect(options.examNames).toEqual(expect.arrayContaining(['Term I Examination', 'Unit Test 1']));
  });

  it("shows a teacher their own quick papers and their classes' exam papers only", async () => {
    expect(new Set(await list('teacher'))).toEqual(new Set([generatedExam, generatedQuick, draftQuick]));
    // The other teacher's class has no exam paper; they see their own quick paper only.
    expect(await list('otherTeacher')).toEqual([otherTeachersQuick]);
  });

  it('refuses someone who may read neither kind of paper', async () => {
    await expectPermissionDenied(world.people.accountant.client.school.listSchoolQuestionPapers({ schoolId: world.schoolId, sessionId: world.sessionId }));
    await expectPermissionDenied(world.people.accountant.client.school.listSchoolQuestionPaperFilterOptions({ schoolId: world.schoolId, sessionId: world.sessionId }));
  });
});
