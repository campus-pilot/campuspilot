import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { examPlanTable } from '@campuspilot/db/schema/exam';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createExamSession, createResultsSchool, createSubjectClass } from '../../../../test/exam-results';
import { expectRpcCode } from '../../../../test/finance/assertions';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  type TestClient,
} from '../../../../test/fixtures';
import { isSchoolSuspendedError } from '../../../school-access/school-access.contract';
import { updateExamClasses } from '../exam/exam-class.service';

type Scope = { schoolId: string; sessionId: string; examSlug: string };

const WRITTEN = { written: { name: 'Written', percentage: 100 } };

/**
 * Subjects added from an examination (exam-only) or to the classroom while
 * examinations exist: where a subject is offered, which plans adding it
 * creates, and who may add it.
 *
 * One active session with two exams, Term 1 (`term`) and Term 2 (`term2`);
 * Class 6 (`maths`) and Class 7 (`maths`). A principal (exam and class
 * configuration grants) and a teacher (class configuration only).
 */
describe('class subjects added from an examination', () => {
  let term: Scope;
  let term2: Scope;
  let principal: TestClient;
  let teacher: TestClient;
  let class6: string;
  let class7: string;

  const plans = (scope: Scope, classId?: string) =>
    db
      .select()
      .from(examPlanTable)
      .where(
        and(
          eq(examPlanTable.sessionId, scope.sessionId),
          eq(examPlanTable.examSlug, scope.examSlug),
          classId ? eq(examPlanTable.classId, classId) : undefined,
        ),
      );
  const planKeys = async (scope: Scope) => (await plans(scope)).map((plan) => `${plan.classId}:${plan.subjectSlug}:${plan.status}`).sort();
  const subjectsOf = async (classId: string) =>
    (await db.select({ config: classTable.config }).from(classTable).where(eq(classTable.id, classId)))[0]!.config.subjects;
  const generate = async (scope: Scope, classIds: string[], subjects?: Record<string, string[]>) => {
    const preview = await principal.school.getExamPlanPreview(scope);
    return principal.school.generateExamPlan({ ...scope, configurationVersion: preview.configurationVersion, classIds, subjects });
  };
  const examOnly = (scope: Scope, classId: string, slug: string, client = principal) =>
    client.school.addClassSubject({
      schoolId: scope.schoolId,
      classId,
      slug,
      name: slug.toUpperCase(),
      examModes: WRITTEN,
      attachment: { kind: 'exam', sessionId: scope.sessionId, examSlug: scope.examSlug },
    });
  const classroom = (classId: string, slug: string, client = principal) =>
    client.school.addClassSubject({
      schoolId: term.schoolId,
      classId,
      slug,
      name: slug.toUpperCase(),
      examModes: WRITTEN,
      attachment: { kind: 'school' },
    });

  beforeEach(async () => {
    const school = await createResultsSchool({ features: ['cadet'] });
    principal = school.principal;
    const schoolId = school.school.id;
    const sessionId = await createExamSession(schoolId, 2026, { term: 'Term 1', term2: 'Term 2' }, { active: true });
    term = { schoolId, sessionId, examSlug: 'term' };
    term2 = { schoolId, sessionId, examSlug: 'term2' };
    class6 = (await createSubjectClass(schoolId, 'Class 6', { maths: 'Mathematics' })).classId;
    class7 = (await createSubjectClass(schoolId, 'Class 7', { maths: 'Mathematics' })).classId;
    teacher = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [] } }])).session);
  });

  describe('exam-only subjects', () => {
    it('are stored with their exam and offered only in that exam', async () => {
      const result = await examOnly(term, class6, 'gk');
      expect(result.createdPlans).toEqual([]);
      expect((await subjectsOf(class6)).gk).toEqual({
        name: 'GK',
        books: [],
        examModes: WRITTEN,
        attachment: { kind: 'exam', exams: [{ sessionId: term.sessionId, examSlug: 'term' }] },
      });
      const subjectSlugs = async (scope: Scope) =>
        (await principal.school.getExamPlanPreview(scope)).classes.find((entry) => entry.classId === class6)!.subjects.map((subject) => subject.subjectSlug).sort();
      expect(await subjectSlugs(term)).toEqual(['gk', 'maths']);
      expect(await subjectSlugs(term2)).toEqual(['maths']);
      // The classroom's own subject count leaves exam-only subjects out.
      const listed = await principal.school.listClasses({ schoolId: term.schoolId });
      expect(listed.find((entry) => entry.id === class6)!.subjectCount).toBe(1);
    });

    it('gets its plan at once when the plan exists and the class takes part', async () => {
      await generate(term, [class6]);
      const result = await examOnly(term, class6, 'gk');
      expect(result.createdPlans).toEqual([expect.objectContaining({ sessionId: term.sessionId, examSlug: 'term' })]);
      expect(await planKeys(term)).toEqual([`${class6}:gk:draft`, `${class6}:maths:draft`]);
      // A class that does not take part gets the subject without a plan.
      expect((await examOnly(term, class7, 'gk')).createdPlans).toEqual([]);
    });

    it('opens the new plan for result entry when the exam has started', async () => {
      await generate(term, [class6]);
      await principal.school.transitionExam({ ...term, status: 'active' });
      await examOnly(term, class6, 'gk');
      expect(await planKeys(term)).toEqual([`${class6}:gk:active`, `${class6}:maths:active`]);
    });

    it('is refused for an exam that has ended or is released to the Cadet Portal', async () => {
      await generate(term, [class6]);
      await principal.school.transitionExam({ ...term, status: 'active' });
      await principal.school.transitionExam({ ...term, status: 'completed' });
      await expectRpcCode(examOnly(term, class6, 'gk'), 'BAD_REQUEST');
      await principal.school.releaseExamToCadet(term);
      await expectRpcCode(examOnly(term, class6, 'gk'), 'BAD_REQUEST');
      expect((await subjectsOf(class6)).gk).toBeUndefined();
    });

    it('is refused for an unknown exam and needs permission to create exam plans', async () => {
      await expectRpcCode(examOnly({ ...term, examSlug: 'missing' }, class6, 'gk'), 'NOT_FOUND');
      await expectRpcCode(examOnly(term, class6, 'gk', teacher), 'FORBIDDEN');
      expect((await subjectsOf(class6)).gk).toBeUndefined();
    });

    it('refuses a slug the class already has', async () => {
      await expectRpcCode(examOnly(term, class6, 'maths'), 'CONFLICT');
      await examOnly(term, class6, 'gk');
      await expectRpcCode(classroom(class6, 'gk'), 'CONFLICT');
    });

    it('cannot get a plan in another exam through the legacy single plan or the timetable', async () => {
      await examOnly(term, class6, 'gk');
      await expectRpcCode(principal.school.createExamPlan({ ...term2, classId: class6, subjectSlug: 'gk' }), 'BAD_REQUEST');
      await generate(term2, [class6]);
      await expectRpcCode(
        principal.school.saveExamTimetable({
          ...term2,
          config: {
            columns: [class6],
            rows: [{ id: 'slot-1', date: '2026-10-20', startTime: '09:00', endTime: '10:00', cells: { [class6]: [{ subjectSlug: 'gk', modeSlug: 'written' }] } }],
          },
        }),
        'BAD_REQUEST',
      );
      const context = await principal.school.getExamContext(term2);
      expect(Object.keys(context.classes.find((entry) => entry.id === class6)!.subjects)).toEqual(['maths']);
    });

    it('is refused for a suspended school', async () => {
      await createTestClient(await createAdminSession()).systemAdmin.suspendSchool({ id: term.schoolId, reason: 'Unpaid' });
      const error = await examOnly(term, class6, 'gk').catch((caught: unknown) => caught);
      expect(isSchoolSuspendedError(error)).toBe(true);
    });
  });

  describe('classroom subjects', () => {
    it('get a plan in every exam the class takes part in that can still change, skipping the others', async () => {
      await generate(term, [class6]);
      await generate(term2, [class6, class7]);
      await principal.school.transitionExam({ ...term2, status: 'active' });
      await principal.school.transitionExam({ ...term2, status: 'completed' });
      const result = await classroom(class6, 'art');
      expect(result.createdPlans.map((plan) => plan.examSlug)).toEqual(['term']);
      expect(await planKeys(term)).toEqual([`${class6}:art:draft`, `${class6}:maths:draft`]);
      expect((await plans(term2, class6)).map((plan) => plan.subjectSlug)).toEqual(['maths']);
      expect((await subjectsOf(class6)).art?.attachment).toEqual({ kind: 'school' });
    });

    it('need permission to create exam plans only when plans would be created', async () => {
      // No exam has a plan yet: the class configuration grant is enough.
      expect((await classroom(class6, 'art', teacher)).createdPlans).toEqual([]);
      await generate(term, [class6]);
      await expect(classroom(class6, 'music', teacher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await subjectsOf(class6)).music).toBeUndefined();
      // A class that takes part in no exam is still the teacher's to change.
      expect((await classroom(class7, 'music', teacher)).createdPlans).toEqual([]);
    });

    it('added through the whole configuration follow the same rules and keep stored attachments', async () => {
      await examOnly(term, class6, 'gk');
      await generate(term, [class6]);
      const stored = await subjectsOf(class6);
      const withArt = { ...stored, art: { name: 'Art', books: [], examModes: WRITTEN } };
      await expectRpcCode(teacher.school.updateClassConfiguration({ schoolId: term.schoolId, classId: class6, config: { subjects: withArt } }), 'FORBIDDEN');
      // Leaving attachment out keeps it; the new subject is a classroom subject with its plan.
      const { gk, ...rest } = stored;
      const updated = await principal.school.updateClassConfiguration({
        schoolId: term.schoolId,
        classId: class6,
        config: { subjects: { ...rest, gk: { name: 'General knowledge', books: gk!.books, examModes: gk!.examModes }, art: withArt.art } },
      });
      expect(updated.config.subjects.gk).toMatchObject({ name: 'General knowledge', attachment: { kind: 'exam' } });
      expect(updated.config.subjects.art?.attachment).toEqual({ kind: 'school' });
      expect(await planKeys(term)).toEqual([`${class6}:art:draft`, `${class6}:gk:draft`, `${class6}:maths:draft`]);
      // Where a subject is offered cannot change here, nor can a new subject be exam-only.
      await expectRpcCode(
        principal.school.updateClassConfiguration({
          schoolId: term.schoolId,
          classId: class6,
          config: { subjects: { ...updated.config.subjects, gk: { ...updated.config.subjects.gk!, attachment: { kind: 'school' } } } },
        }),
        'BAD_REQUEST',
      );
      await expectRpcCode(
        principal.school.updateClassConfiguration({
          schoolId: term.schoolId,
          classId: class6,
          config: {
            subjects: {
              ...updated.config.subjects,
              quiz: { name: 'Quiz', books: [], examModes: WRITTEN, attachment: { kind: 'exam', exams: [{ sessionId: term.sessionId, examSlug: 'term' }] } },
            },
          },
        }),
        'BAD_REQUEST',
      );
    });

    it('are the only kind a new class gets', async () => {
      const created = await principal.school.createClass({
        schoolId: term.schoolId,
        slug: 'class-8',
        label: 'Class 8',
        config: { subjects: { maths: { name: 'Mathematics', books: [], examModes: WRITTEN } } },
        sections: [{ slug: 'a', label: 'A' }],
      });
      expect(created.config.subjects.maths?.attachment).toEqual({ kind: 'school' });
      await expectRpcCode(
        principal.school.createClass({
          schoolId: term.schoolId,
          slug: 'class-9',
          label: 'Class 9',
          config: {
            subjects: {
              gk: { name: 'GK', books: [], examModes: WRITTEN, attachment: { kind: 'exam', exams: [{ sessionId: term.sessionId, examSlug: 'term' }] } },
            },
          },
          sections: [{ slug: 'a', label: 'A' }],
        }),
        'BAD_REQUEST',
      );
    });
  });

  describe('moving an exam-only subject to the classroom', () => {
    it('keeps its plan and adds plans in the other exams the class takes part in', async () => {
      await generate(term, [class6]);
      await generate(term2, [class6]);
      await examOnly(term, class6, 'gk');
      await expectRpcCode(teacher.school.moveClassSubjectToClassroom({ schoolId: term.schoolId, classId: class6, subjectSlug: 'gk' }), 'FORBIDDEN');
      const moved = await principal.school.moveClassSubjectToClassroom({ schoolId: term.schoolId, classId: class6, subjectSlug: 'gk' });
      expect(moved.class.config.subjects.gk?.attachment).toEqual({ kind: 'school' });
      expect(moved.createdPlans.map((plan) => plan.examSlug)).toEqual(['term2']);
      expect(await planKeys(term)).toEqual([`${class6}:gk:draft`, `${class6}:maths:draft`]);
      expect(await planKeys(term2)).toEqual([`${class6}:gk:draft`, `${class6}:maths:draft`]);
      expect((await principal.school.listClasses({ schoolId: term.schoolId })).find((entry) => entry.id === class6)!.subjectCount).toBe(2);
      await expectRpcCode(principal.school.moveClassSubjectToClassroom({ schoolId: term.schoolId, classId: class6, subjectSlug: 'gk' }), 'BAD_REQUEST');
      await expectRpcCode(principal.school.moveClassSubjectToClassroom({ schoolId: term.schoolId, classId: class6, subjectSlug: 'missing' }), 'NOT_FOUND');
    });
  });

  describe('choosing subjects when classes join', () => {
    it('plans only the chosen subjects at generation', async () => {
      await examOnly(term, class6, 'gk');
      expect(await generate(term, [class6, class7], { [class6]: ['gk'] })).toEqual({ createdCount: 2 });
      expect(await planKeys(term)).toEqual([`${class6}:gk:draft`, `${class7}:maths:draft`]);
    });

    it('refuses a choice naming a subject of another exam, none at all, or a class that does not join', async () => {
      await examOnly(term2, class6, 'gk');
      await expectRpcCode(generate(term, [class6], { [class6]: ['gk'] }), 'BAD_REQUEST');
      await expectRpcCode(generate(term, [class6], { [class6]: [] }), 'BAD_REQUEST');
      await expectRpcCode(generate(term, [class6], { [class7]: ['maths'] }), 'BAD_REQUEST');
      expect(await plans(term)).toEqual([]);
    });

    it('plans only the chosen subjects of a class added later', async () => {
      await examOnly(term, class7, 'gk');
      await generate(term, [class6]);
      const preview = await principal.school.getExamPlanPreview(term);
      const result = await principal.school.updateExamClasses({
        ...term,
        configurationVersion: preview.configurationVersion,
        classIds: [class6, class7],
        subjects: { [class7]: ['gk'] },
      });
      expect(result.createdPlanCount).toBe(1);
      expect(await planKeys(term)).toEqual([`${class6}:maths:draft`, `${class7}:gk:draft`]);
    });
  });

  describe('removing an exam', () => {
    it('removes the subjects added only for it, with deleteExam', async () => {
      await examOnly(term, class6, 'gk');
      await examOnly(term2, class6, 'quiz');
      await principal.school.deleteExam(term);
      expect(Object.keys(await subjectsOf(class6)).sort()).toEqual(['maths', 'quiz']);
    });

    it('removes them when session settings drop the exam or change its slug', async () => {
      await examOnly(term2, class7, 'quiz');
      const session = await principal.school.getSession({ schoolId: term.schoolId, sessionId: term.sessionId });
      const examConfig = { ...session.sessionConfig!.examConfig };
      examConfig.term3 = examConfig.term2!;
      delete examConfig.term2;
      await principal.school.updateSession({
        schoolId: term.schoolId,
        sessionId: term.sessionId,
        sessionConfig: { ...session.sessionConfig!, examConfig },
      });
      expect(Object.keys(await subjectsOf(class7))).toEqual(['maths']);
    });

    it('removes them with their session when the session is deleted', async () => {
      await examOnly(term, class6, 'gk');
      await createExamSession(term.schoolId, 2027, { final: 'Final' }, { active: true });
      await principal.school.deleteSession({ schoolId: term.schoolId, sessionId: term.sessionId });
      expect(Object.keys(await subjectsOf(class6))).toEqual(['maths']);
    });

    it('keeps an exam with plans, and its exam-only subjects, as before', async () => {
      await generate(term, [class6]);
      await examOnly(term, class6, 'gk');
      await expectRpcCode(principal.school.deleteExam(term), 'CONFLICT');
      expect((await subjectsOf(class6)).gk).toBeDefined();
    });
  });

  describe('changing one subject', () => {
    const update = (classId: string, subjectSlug: string, changes: { slug?: string; name?: string }, client = principal) =>
      client.school.updateClassSubject({ schoolId: term.schoolId, classId, subjectSlug, name: changes.name ?? 'Renamed', examModes: WRITTEN, slug: changes.slug });

    it('renames a subject without plans, keeping where it is offered and creating no plans, with the class grant alone', async () => {
      await generate(term, [class6]);
      await examOnly(term, class7, 'gk');
      const renamed = await update(class7, 'gk', { slug: 'general-knowledge', name: 'General knowledge' }, teacher);
      expect(renamed.class.config.subjects.gk).toBeUndefined();
      expect(renamed.class.config.subjects['general-knowledge']).toMatchObject({
        name: 'General knowledge',
        attachment: { kind: 'exam', exams: [{ sessionId: term.sessionId, examSlug: 'term' }] },
      });
      // A classroom subject of a class taking part is renamed the same way: it is not a new subject.
      await classroom(class6, 'art');
      await principal.school.deleteExamPlan({
        schoolId: term.schoolId,
        sessionId: term.sessionId,
        classId: class6,
        examPlanId: (await plans(term, class6)).find((plan) => plan.subjectSlug === 'art')!.id,
      });
      await update(class6, 'art', { slug: 'drawing' }, teacher);
      expect(await planKeys(term)).toEqual([`${class6}:maths:draft`]);
    });

    it('refuses a new slug while the subject has plans, but changes its name and modes', async () => {
      await generate(term, [class6]);
      await expect(update(class6, 'maths', { slug: 'mathematics' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const renamed = await update(class6, 'maths', { name: 'Mathematics (core)' });
      expect(renamed.class.config.subjects.maths).toMatchObject({ name: 'Mathematics (core)', attachment: { kind: 'school' } });
      // The whole configuration cannot change the slug of a planned subject either.
      const { maths, ...rest } = renamed.class.config.subjects;
      await expectRpcCode(
        principal.school.updateClassConfiguration({ schoolId: term.schoolId, classId: class6, config: { subjects: { ...rest, mathematics: maths! } } }),
        'BAD_REQUEST',
      );
    });

    it('refuses a slug the class already has, naming the exam of a hidden exam-only subject', async () => {
      await examOnly(term2, class6, 'gk');
      await expect(examOnly(term, class6, 'gk')).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('“Term 2”') });
      await classroom(class6, 'art');
      await expect(update(class6, 'art', { slug: 'gk' })).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('move that subject to the classroom') });
      await expectRpcCode(update(class6, 'missing', {}), 'NOT_FOUND');
    });

    it('validates input and checks permissions', async () => {
      await expectRpcCode(
        principal.school.updateClassSubject({ schoolId: term.schoolId, classId: class6, subjectSlug: 'maths', name: 'Maths', examModes: { written: { name: 'Written', percentage: 90 } } }),
        'BAD_REQUEST',
      );
      const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`m${index}`, { name: `M${index}`, percentage: index === 0 ? 80 : 1 }]));
      await expectRpcCode(principal.school.updateClassSubject({ schoolId: term.schoolId, classId: class6, subjectSlug: 'maths', name: 'Maths', examModes: tooMany }), 'BAD_REQUEST');
      await expectRpcCode(update(class6, 'maths', {}, createTestClient(await createRegularUserSession())), 'FORBIDDEN');
      await expectRpcCode(update(class6, 'maths', {}, createTestClient(null)), 'UNAUTHORIZED');
      await expectRpcCode(
        createTestClient(null).school.removeClassSubject({ schoolId: term.schoolId, classId: class6, subjectSlug: 'maths' }),
        'UNAUTHORIZED',
      );
    });
  });

  describe('removing one subject', () => {
    it('removes a subject without plans and refuses one with plans, also through the whole configuration', async () => {
      await classroom(class7, 'art');
      const removed = await teacher.school.removeClassSubject({ schoolId: term.schoolId, classId: class7, subjectSlug: 'art' });
      expect(removed.class.config.subjects.art).toBeUndefined();
      expect(Object.keys(removed.class.config.subjects)).toEqual(['maths']);
      await generate(term, [class6]);
      await expect(principal.school.removeClassSubject({ schoolId: term.schoolId, classId: class6, subjectSlug: 'maths' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('“Term 1”'),
      });
      await expectRpcCode(principal.school.updateClassConfiguration({ schoolId: term.schoolId, classId: class6, config: { subjects: {} } }), 'BAD_REQUEST');
      expect((await subjectsOf(class6)).maths).toBeDefined();
      await expectRpcCode(principal.school.removeClassSubject({ schoolId: term.schoolId, classId: class6, subjectSlug: 'missing' }), 'NOT_FOUND');
    });
  });

  describe('subjects of classes already taking part', () => {
    const updateSubjects = async (scope: Scope, classIds: string[], subjects: Record<string, string[]>) => {
      const preview = await principal.school.getExamPlanPreview(scope);
      return principal.school.updateExamClasses({ ...scope, configurationVersion: preview.configurationVersion, classIds, subjects });
    };

    it('reports which subjects are planned, adds a plan for a subject left out at creation and removes one again', async () => {
      await classroom(class6, 'art');
      await generate(term, [class6], { [class6]: ['maths'] });
      const preview = await principal.school.getExamPlanPreview(term);
      expect(preview.classes.find((entry) => entry.classId === class6)!.subjects.map((subject) => [subject.subjectSlug, subject.planned]).sort()).toEqual([
        ['art', false],
        ['maths', true],
      ]);
      const added = await updateSubjects(term, [class6], { [class6]: ['maths', 'art'] });
      expect(added).toMatchObject({ addedClassIds: [], removedClassIds: [], createdPlanCount: 1, deletedPlanCount: 0 });
      expect(await planKeys(term)).toEqual([`${class6}:art:draft`, `${class6}:maths:draft`]);
      const removed = await updateSubjects(term, [class6], { [class6]: ['art'] });
      expect(removed).toMatchObject({ createdPlanCount: 0, deletedPlanCount: 1 });
      expect(await planKeys(term)).toEqual([`${class6}:art:draft`]);
      // Left out of `subjects`, a class keeps its plans.
      const preview2 = await principal.school.getExamPlanPreview(term);
      await principal.school.updateExamClasses({ ...term, configurationVersion: preview2.configurationVersion, classIds: [class6, class7] });
      expect(await planKeys(term)).toEqual([`${class6}:art:draft`, `${class7}:maths:draft`]);
    });

    it('opens a plan added after the start for result entry', async () => {
      await classroom(class6, 'art');
      await generate(term, [class6], { [class6]: ['maths'] });
      await principal.school.transitionExam({ ...term, status: 'active' });
      await updateSubjects(term, [class6], { [class6]: ['maths', 'art'] });
      expect(await planKeys(term)).toEqual([`${class6}:art:active`, `${class6}:maths:active`]);
    });

    it('refuses removing a subject the timetable schedules', async () => {
      await classroom(class6, 'art');
      await generate(term, [class6]);
      await principal.school.saveExamTimetable({
        ...term,
        config: {
          columns: [class6],
          rows: [{ id: 'slot-1', date: '2026-10-20', startTime: '09:00', endTime: '10:00', cells: { [class6]: [{ subjectSlug: 'art', modeSlug: 'written' }] } }],
        },
      });
      await expect(updateSubjects(term, [class6], { [class6]: ['maths'] })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('timetable') });
      expect(await planKeys(term)).toEqual([`${class6}:art:draft`, `${class6}:maths:draft`]);
    });

    it('refuses a choice for a class that does not take part after the change', async () => {
      await generate(term, [class6]);
      await expectRpcCode(updateSubjects(term, [class6], { [class7]: ['maths'] }), 'BAD_REQUEST');
    });
  });

  describe('timetable and plans', () => {
    const slot = (subjectSlug: string, modeSlug = 'written') => ({
      columns: [class6],
      rows: [{ id: 'slot-1', date: '2026-10-20', startTime: '09:00', endTime: '10:00', cells: { [class6]: [{ subjectSlug, modeSlug }] } }],
    });

    it('schedules only subjects with their plan in the exam, with a mode of that plan, and lists only those in the context', async () => {
      await classroom(class6, 'art');
      await generate(term, [class6], { [class6]: ['maths'] });
      // Offered but left out of the plan: not listed and not schedulable.
      const context = await principal.school.getExamContext(term);
      expect(Object.keys(context.classes.find((entry) => entry.id === class6)!.subjects)).toEqual(['maths']);
      await expectRpcCode(principal.school.saveExamTimetable({ ...term, config: slot('art') }), 'BAD_REQUEST');
      await expectRpcCode(principal.school.saveExamTimetable({ ...term, config: slot('maths', 'oral') }), 'BAD_REQUEST');
      await principal.school.saveExamTimetable({ ...term, config: slot('maths') });
      // The unscheduled, unplanned subject can then be removed without leaving a cell behind.
      await principal.school.removeClassSubject({ schoolId: term.schoolId, classId: class6, subjectSlug: 'art' });
      const timetable = await principal.school.getExamTimetable(term);
      expect(timetable!.config.rows[0]!.cells[class6]).toEqual([{ subjectSlug: 'maths', modeSlug: 'written' }]);
    });
  });

  describe('exam context modes and deleting a scheduled plan', () => {
    it("lists each planned subject's plan modes, named from the class subject, not modes added later", async () => {
      await generate(term, [class6]);
      // Class settings change after the plan: a new mode, and the plan's mode renamed.
      await principal.school.updateClassSubject({
        schoolId: term.schoolId,
        classId: class6,
        subjectSlug: 'maths',
        name: 'Mathematics',
        examModes: { written: { name: 'Theory', percentage: 80 }, oral: { name: 'Oral', percentage: 20 } },
      });
      const context = await principal.school.getExamContext(term);
      expect(context.classes.find((entry) => entry.id === class6)!.subjects).toEqual({
        maths: { name: 'Mathematics', examModes: { written: { name: 'Theory', percentage: 100, maxMarks: 100 } } },
      });
      const slot = (modeSlug: string) => ({
        columns: [class6],
        rows: [{ id: 'slot-1', date: '2026-10-20', startTime: '09:00', endTime: '10:00', cells: { [class6]: [{ subjectSlug: 'maths', modeSlug }] } }],
      });
      await expectRpcCode(principal.school.saveExamTimetable({ ...term, config: slot('oral') }), 'BAD_REQUEST');
      await principal.school.saveExamTimetable({ ...term, config: slot('written') });
    });

    it('refuses deleting a plan whose subject the timetable schedules', async () => {
      await classroom(class6, 'art');
      await generate(term, [class6]);
      await principal.school.saveExamTimetable({
        ...term,
        config: {
          columns: [class6],
          rows: [{ id: 'slot-1', date: '2026-10-20', startTime: '09:00', endTime: '10:00', cells: { [class6]: [{ subjectSlug: 'art', modeSlug: 'written' }] } }],
        },
      });
      const [art] = (await plans(term, class6)).filter((plan) => plan.subjectSlug === 'art');
      const [maths] = (await plans(term, class6)).filter((plan) => plan.subjectSlug === 'maths');
      const planScope = { schoolId: term.schoolId, sessionId: term.sessionId, classId: class6 };
      await expect(principal.school.deleteExamPlan({ ...planScope, examPlanId: art!.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('timetable'),
      });
      // An unscheduled subject's plan still goes.
      await principal.school.deleteExamPlan({ ...planScope, examPlanId: maths!.id });
      expect(await planKeys(term)).toEqual([`${class6}:art:draft`]);
    });
  });

  describe('plan create and delete permissions of updateExamClasses', () => {
    const change = async (scope: Scope, classIds: string[], subjects: Record<string, string[]> | undefined, permission: { canCreate: boolean; canDelete: boolean }) => {
      const preview = await principal.school.getExamPlanPreview(scope);
      return db.transaction((tx) => updateExamClasses(tx, { ...scope, configurationVersion: preview.configurationVersion, classIds, subjects }, permission));
    };

    it('needs create permission to add plans and delete permission to remove them', async () => {
      await classroom(class6, 'art');
      await generate(term, [class6], { [class6]: ['maths'] });
      await expect(change(term, [class6, class7], undefined, { canCreate: false, canDelete: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(change(term, [class6], { [class6]: ['maths', 'art'] }, { canCreate: false, canDelete: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await change(term, [class6, class7], { [class6]: ['maths', 'art'] }, { canCreate: true, canDelete: false });
      expect(await planKeys(term)).toEqual([`${class6}:art:draft`, `${class6}:maths:draft`, `${class7}:maths:draft`]);
      await expect(change(term, [class6, class7], { [class6]: ['art'] }, { canCreate: true, canDelete: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(change(term, [class6], undefined, { canCreate: true, canDelete: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      // Removing a class and a subject with the grant works, under the usual guards.
      await change(term, [class6], { [class6]: ['art'] }, { canCreate: false, canDelete: true });
      expect(await planKeys(term)).toEqual([`${class6}:art:draft`]);
    });

    it('is allowed through the procedure for roles holding every plan grant', async () => {
      await generate(term, [class6]);
      const coordinator = createTestClient((await createSchoolStaffSession(term.schoolId, [{ role: 'exam_coordinator' }])).session);
      const preview = await coordinator.school.getExamPlanPreview(term);
      expect((await coordinator.school.updateExamClasses({ ...term, configurationVersion: preview.configurationVersion, classIds: [class7] })).removedClassIds).toEqual([class6]);
    });
  });
});
