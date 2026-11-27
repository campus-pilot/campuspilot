import type { DatabaseExecutor, DatabaseTransaction } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { examClassTable, examLifecycleTable, examPlanTable } from '@campuspilot/db/schema/exam';
import {
  isSubjectOfferedInExam,
  type ClassConfig,
  type ClassConfigSubmission,
  type Subject,
  type SubjectAttachment,
  type SubjectExamRef,
} from '@campuspilot/db/schema/jsonb/class-config';
import { sessionConfigSchema } from '@campuspilot/db/schema/jsonb/session-config';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { rpcError, toRpcError } from '../../../errors';
import { getExam, resolveModeConfig } from '../exam/exam.service';
import type {
  addClassSubjectInputSchema,
  classSubjectInputSchema,
  updateClassConfigurationInputSchema,
  updateClassSubjectInputSchema,
} from './class.dto';
import { toClassDto } from './class.dto';

type ClassRow = typeof classTable.$inferSelect;
type ExamPlanInsert = typeof examPlanTable.$inferInsert;
type LockedSession = { id: string; examNames: Map<string, string> };

/**
 * Whether the caller also holds `CREATE_EXAM_PLAN` for the school, resolved
 * before the handler (`resolveCanCreateExamPlan`). A subject that joins a
 * class creates plans in the examinations the class takes part in, which is
 * a plan creation; the class configuration grant alone never creates plans.
 */
export type SubjectPlanPermission = { canCreateExamPlan: boolean };

/** The total marks of every plan a subject change creates, as at generation. */
const TOTAL_MARKS = 100;

type LockedLifecycle = { sessionId: string; examSlug: string; status: 'ready' | 'active' | 'completed'; cadetReleasedAt: Date | null };

/**
 * Locks what a subject change reads. The lock order is fixed and matches
 * every other exam writer that also takes the class row (legacy
 * `createExamPlan`: session, lifecycle, class):
 *
 * 1. the school's active session FOR SHARE (plan generation, class changes,
 *    lifecycle transitions and exam removal take it FOR UPDATE and wait);
 * 2. that session's `exam_lifecycle` rows FOR SHARE, in key order (completion
 *    and Cadet Portal release cannot change under the decisions below);
 * 3. the class row FOR UPDATE (concurrent subject changes, generation and
 *    `deleteClass` serialise with this one).
 *
 * Only an active session can receive new plans, so no other session is
 * locked. Callers that lock more (an exam's session and lifecycle through
 * `assertExamTakesSubjects`) do so before calling this, in the same order.
 */
export async function lockClassForSubjectChange(
  tx: DatabaseTransaction,
  schoolId: string,
  classId: string,
): Promise<{ schoolClass: ClassRow; sessions: LockedSession[]; lifecycles: LockedLifecycle[] }> {
  const sessions = await tx
    .select({ id: schoolSessionTable.id, sessionConfig: schoolSessionTable.sessionConfig })
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.schoolId, schoolId), eq(schoolSessionTable.isActive, true)))
    .orderBy(asc(schoolSessionTable.id))
    .for('share');
  const lifecycles = sessions.length
    ? await tx
        .select({
          sessionId: examLifecycleTable.sessionId,
          examSlug: examLifecycleTable.examSlug,
          status: examLifecycleTable.status,
          cadetReleasedAt: examLifecycleTable.cadetReleasedAt,
        })
        .from(examLifecycleTable)
        .where(
          and(
            eq(examLifecycleTable.schoolId, schoolId),
            inArray(
              examLifecycleTable.sessionId,
              sessions.map((session) => session.id),
            ),
          ),
        )
        .orderBy(asc(examLifecycleTable.sessionId), asc(examLifecycleTable.examSlug))
        .for('share')
    : [];
  const [schoolClass] = await tx
    .select()
    .from(classTable)
    .where(and(eq(classTable.schoolId, schoolId), eq(classTable.id, classId)))
    .for('update')
    .limit(1);
  if (!schoolClass) throw rpcError.notFound('Class');
  return {
    schoolClass,
    lifecycles,
    sessions: sessions.map((session) => ({
      id: session.id,
      examNames: new Map(
        Object.entries(sessionConfigSchema.parse(session.sessionConfig ?? {}).examConfig).map(([slug, exam]) => [slug, exam.name]),
      ),
    })),
  };
}

type LockedClass = Awaited<ReturnType<typeof lockClassForSubjectChange>>;

/** An examination a subject joining the class gets its plan in. */
type ReceivingExam = SubjectExamRef & { name: string; status: 'ready' | 'active' };

/**
 * The examinations in which a subject that joins the class now gets its plan
 * in the same transaction: examinations of the locked active session that
 * still define them, that the class takes part in (`exam_class`), whose plan
 * exists (the examination has at least one plan: before that, generation
 * plans the subject), that have not ended (`completed`) and are not released
 * to the Cadet Portal. Examinations that cannot change are skipped, never
 * refused: the subject is still added to the class. `only` narrows the
 * result to one examination (an exam-only subject).
 */
export async function examsReceivingNewSubjects(
  tx: DatabaseTransaction,
  { schoolClass, sessions, lifecycles }: LockedClass,
  only?: SubjectExamRef,
): Promise<ReceivingExam[]> {
  const sessionIds = sessions.map((session) => session.id).filter((id) => !only || id === only.sessionId);
  if (!sessionIds.length) return [];
  const participations = await tx
    .select({ sessionId: examClassTable.sessionId, examSlug: examClassTable.examSlug })
    .from(examClassTable)
    .where(
      and(
        eq(examClassTable.schoolId, schoolClass.schoolId),
        eq(examClassTable.classId, schoolClass.id),
        inArray(examClassTable.sessionId, sessionIds),
      ),
    )
    .orderBy(asc(examClassTable.sessionId), asc(examClassTable.examSlug));
  const exams: ReceivingExam[] = [];
  for (const participation of participations) {
    if (only && participation.examSlug !== only.examSlug) continue;
    const name = sessions.find((session) => session.id === participation.sessionId)?.examNames.get(participation.examSlug);
    if (name === undefined) continue;
    const scope = { schoolId: schoolClass.schoolId, ...participation };
    // Read from the rows locked in `lockClassForSubjectChange`.
    const lifecycle = lifecycles.find((row) => row.sessionId === scope.sessionId && row.examSlug === scope.examSlug);
    if (!lifecycle || lifecycle.status === 'completed' || lifecycle.cadetReleasedAt) continue;
    const [plans] = await tx
      .select({ value: count() })
      .from(examPlanTable)
      .where(
        and(
          eq(examPlanTable.schoolId, scope.schoolId),
          eq(examPlanTable.sessionId, scope.sessionId),
          eq(examPlanTable.examSlug, scope.examSlug),
        ),
      );
    if (!plans?.value) continue;
    exams.push({ ...participation, name, status: lifecycle.status === 'active' ? 'active' : 'ready' });
  }
  return exams;
}

/**
 * The plans to create for subjects joining a class, one per receiving
 * examination the subject is offered in ({@link isSubjectOfferedInExam})
 * that has no plan for it yet (a plan left behind by a subject deleted
 * earlier under the same slug is kept, not duplicated). They follow the rules
 * for a class added with `updateExamClasses`: 100 total marks, modes from the
 * subject, `active` when the examination has started, otherwise `draft`.
 * Modes that cannot make a plan refuse the whole change.
 */
async function plansForNewSubjects(
  tx: DatabaseTransaction,
  schoolClass: ClassRow,
  exams: readonly ReceivingExam[],
  subjects: ReadonlyArray<readonly [string, Subject]>,
): Promise<ExamPlanInsert[]> {
  if (!exams.length || !subjects.length) return [];
  const existing = await tx
    .select({ sessionId: examPlanTable.sessionId, examSlug: examPlanTable.examSlug, subjectSlug: examPlanTable.subjectSlug })
    .from(examPlanTable)
    .where(
      and(
        eq(examPlanTable.schoolId, schoolClass.schoolId),
        eq(examPlanTable.classId, schoolClass.id),
        inArray(examPlanTable.sessionId, [...new Set(exams.map((exam) => exam.sessionId))]),
        inArray(
          examPlanTable.subjectSlug,
          subjects.map(([slug]) => slug),
        ),
      ),
    );
  const plans: ExamPlanInsert[] = [];
  for (const exam of exams)
    for (const [subjectSlug, subject] of subjects) {
      if (!isSubjectOfferedInExam(subject, exam)) continue;
      if (existing.some((plan) => plan.sessionId === exam.sessionId && plan.examSlug === exam.examSlug && plan.subjectSlug === subjectSlug))
        continue;
      let modeConfig;
      try {
        modeConfig = resolveModeConfig(TOTAL_MARKS, subject.examModes);
      } catch (error) {
        const failure = toRpcError(error);
        if (failure.code !== 'BAD_REQUEST') throw failure;
        throw rpcError.badRequest(
          `${schoolClass.label} takes part in “${exam.name}”, so ${subject.name} gets a plan there: ${failure.message}`,
        );
      }
      plans.push({
        schoolId: schoolClass.schoolId,
        sessionId: exam.sessionId,
        examSlug: exam.examSlug,
        classId: schoolClass.id,
        subjectSlug,
        totalMarks: TOTAL_MARKS,
        modeConfig,
        totalWorkingDays: null,
        status: exam.status === 'active' ? 'active' : 'draft',
      });
    }
  return plans;
}

/**
 * Refuses plans the caller may not create. A subject joining a class that
 * takes part in an examination that can still change gets its plan there;
 * that needs `CREATE_EXAM_PLAN` as well as the class configuration grant.
 * Plans are never created without it and never skipped because of it.
 */
function assertMayCreatePlans(
  schoolClass: ClassRow,
  plans: readonly ExamPlanInsert[],
  exams: readonly ReceivingExam[],
  permission: SubjectPlanPermission,
) {
  if (!plans.length || permission.canCreateExamPlan) return;
  const names = [...new Set(plans.map((plan) => exams.find((exam) => exam.sessionId === plan.sessionId && exam.examSlug === plan.examSlug)?.name))]
    .filter((name): name is string => name !== undefined)
    .map((name) => `“${name}”`)
    .join(', ');
  throw rpcError.forbidden(
    `${schoolClass.label} takes part in ${names}, so a new subject also gets a plan there. That needs permission to create exam plans; ask a principal, manager or exam coordinator.`,
  );
}

async function insertPlans(tx: DatabaseTransaction, plans: readonly ExamPlanInsert[]) {
  const created: Array<{ sessionId: string; examSlug: string; examPlanId: string }> = [];
  for (let offset = 0; offset < plans.length; offset += 100) {
    const rows = await tx
      .insert(examPlanTable)
      .values(plans.slice(offset, offset + 100))
      .returning({ sessionId: examPlanTable.sessionId, examSlug: examPlanTable.examSlug, examPlanId: examPlanTable.id });
    created.push(...rows);
  }
  return created;
}

/**
 * Sets one subject of a class, leaving every other subject as stored: a
 * merge of a single key under the class row lock, never a rewrite of the
 * whole configuration from a copy the caller read earlier.
 */
async function writeSubject(tx: DatabaseTransaction, classId: string, slug: string, subject: Subject) {
  const [updated] = await tx
    .update(classTable)
    .set({
      config: sql`jsonb_set(${classTable.config}, '{subjects}', coalesce(${classTable.config} -> 'subjects', '{}'::jsonb) || jsonb_build_object(${slug}::text, ${JSON.stringify(subject)}::jsonb))`,
      updatedAt: new Date(),
    })
    .where(eq(classTable.id, classId))
    .returning();
  return updated!;
}

/**
 * The refusal of a slug the class already has. When the subject holding it
 * is exam-only for another examination (so it is not shown in this one), the
 * message names that examination and points to Move to classroom, which
 * makes it usable everywhere.
 */
function slugTakenError({ schoolClass, sessions }: LockedClass, slug: string, exam?: SubjectExamRef) {
  const holder = Object.hasOwn(schoolClass.config.subjects, slug) ? schoolClass.config.subjects[slug]! : undefined;
  if (holder?.attachment.kind === 'exam' && !(exam && isSubjectOfferedInExam(holder, exam))) {
    const names = holder.attachment.exams.map(
      (entry) => sessions.find((session) => session.id === entry.sessionId)?.examNames.get(entry.examSlug) ?? 'another examination',
    );
    return rpcError.conflict(
      `${schoolClass.label} already has “${holder.name}” (${slug}), added only for ${names.map((name) => `“${name}”`).join(', ')}. Choose another slug, or move that subject to the classroom (Classroom → Subjects) to use it in every examination.`,
    );
  }
  return rpcError.conflict(`${schoolClass.label} already has a subject with the slug “${slug}”. Choose another slug.`);
}

/**
 * Refuses a change that would leave plans without their subject: removing a
 * subject, or changing its slug (plans, results and question papers refer to
 * the slug), while any `exam_plan` row of the class has that slug, in any
 * session. Delete those plans first (or remove the class from those
 * examinations); a subject without plans can be removed or renamed freely.
 */
async function assertSubjectHasNoPlans(
  tx: DatabaseTransaction,
  { schoolClass, sessions }: LockedClass,
  slugs: readonly string[],
  change: 'remove' | 'rename',
) {
  if (!slugs.length) return;
  const [plan] = await tx
    .select({ subjectSlug: examPlanTable.subjectSlug, sessionId: examPlanTable.sessionId, examSlug: examPlanTable.examSlug })
    .from(examPlanTable)
    .where(and(eq(examPlanTable.schoolId, schoolClass.schoolId), eq(examPlanTable.classId, schoolClass.id), inArray(examPlanTable.subjectSlug, [...slugs])))
    .orderBy(asc(examPlanTable.subjectSlug), asc(examPlanTable.sessionId), asc(examPlanTable.examSlug))
    .limit(1);
  if (!plan) return;
  const subject = Object.hasOwn(schoolClass.config.subjects, plan.subjectSlug) ? schoolClass.config.subjects[plan.subjectSlug]! : undefined;
  const name = subject?.name ?? plan.subjectSlug;
  const exam = sessions.find((session) => session.id === plan.sessionId)?.examNames.get(plan.examSlug);
  const where = exam ? `“${exam}”` : 'an examination';
  throw rpcError.badRequest(
    change === 'remove'
      ? `${name} has a plan in ${where}, so it cannot be removed from ${schoolClass.label}. Delete its plans (or take the class out of those examinations) first.`
      : `${name} has a plan in ${where}, so its slug cannot change: plans, marks and question papers refer to it. Its name and exam modes can still change.`,
  );
}

/**
 * Adds one subject to a class (`school.addClassSubject`).
 *
 * - `attachment.kind = 'exam'`: an exam-only subject, offered only in that
 *   examination. The examination must exist in an active session and still
 *   be changeable (not completed, not released to the Cadet Portal). When
 *   its plan exists and the class takes part, the subject's plan is created
 *   too. The procedure already required `CREATE_EXAM_PLAN`.
 * - `attachment.kind = 'school'`: a classroom subject. It gets a plan in
 *   every examination the class takes part in that can still change
 *   ({@link examsReceivingNewSubjects}); if there is one, the caller must
 *   hold `CREATE_EXAM_PLAN` too ({@link assertMayCreatePlans}).
 *
 * A slug the class already has is a CONFLICT ({@link slugTakenError}).
 */
export async function addClassSubject(
  tx: DatabaseTransaction,
  input: z.infer<typeof addClassSubjectInputSchema>,
  permission: SubjectPlanPermission,
) {
  const only = input.attachment.kind === 'exam' ? { sessionId: input.attachment.sessionId, examSlug: input.attachment.examSlug } : undefined;
  if (only) await assertExamTakesSubjects(tx, { schoolId: input.schoolId, ...only });
  const locked = await lockClassForSubjectChange(tx, input.schoolId, input.classId);
  const { schoolClass } = locked;
  if (Object.hasOwn(schoolClass.config.subjects, input.slug)) throw slugTakenError(locked, input.slug, only);
  const attachment: SubjectAttachment = only ? { kind: 'exam', exams: [only] } : { kind: 'school' };
  const subject: Subject = { name: input.name, books: [], examModes: input.examModes, attachment };
  const exams = await examsReceivingNewSubjects(tx, locked, only);
  const plans = await plansForNewSubjects(tx, schoolClass, exams, [[input.slug, subject]]);
  assertMayCreatePlans(schoolClass, plans, exams, permission);
  const updated = await writeSubject(tx, schoolClass.id, input.slug, subject);
  return { class: toClassDto(updated), createdPlans: await insertPlans(tx, plans) };
}

/**
 * Refuses adding an exam-only subject for an examination that cannot take
 * new subjects: it must be defined in an active session (`getExam` with a
 * lock refuses an inactive one), not completed and not released to the
 * Cadet Portal. Locks the session, then the exam's lifecycle, FOR SHARE: the
 * order of {@link lockClassForSubjectChange}, which runs after this.
 */
async function assertExamTakesSubjects(tx: DatabaseTransaction, scope: SubjectExamRef & { schoolId: string }) {
  await getExam(tx, scope, 'share');
  const [lifecycle] = await tx
    .select({ status: examLifecycleTable.status, cadetReleasedAt: examLifecycleTable.cadetReleasedAt })
    .from(examLifecycleTable)
    .where(
      and(
        eq(examLifecycleTable.schoolId, scope.schoolId),
        eq(examLifecycleTable.sessionId, scope.sessionId),
        eq(examLifecycleTable.examSlug, scope.examSlug),
      ),
    )
    .for('share');
  if (lifecycle?.cadetReleasedAt)
    throw rpcError.badRequest('This examination is released to the Cadet Portal. Withdraw it before adding subjects.');
  if (lifecycle?.status === 'completed')
    throw rpcError.badRequest('This examination has ended, so subjects can no longer be added to it. Reopen it first.');
}

/**
 * Changes one subject of a class (`school.updateClassSubject`): its name and
 * exam modes, and optionally its slug. Books and where it is offered stay.
 * Every other subject stays as stored (one key changes under the class lock).
 *
 * A new slug is a **rename** of the same subject, never a new subject: the
 * key moves with its attachment and no plan is created, so it needs no exam
 * permission. It is refused while the subject has any plan
 * ({@link assertSubjectHasNoPlans}) and for a slug the class already has.
 * Changing the modes of a subject with plans is allowed as before: plans
 * keep the modes they were created with.
 */
export async function updateClassSubject(tx: DatabaseTransaction, input: z.infer<typeof updateClassSubjectInputSchema>) {
  const locked = await lockClassForSubjectChange(tx, input.schoolId, input.classId);
  const { schoolClass } = locked;
  const stored = Object.hasOwn(schoolClass.config.subjects, input.subjectSlug) ? schoolClass.config.subjects[input.subjectSlug] : undefined;
  if (!stored) throw rpcError.notFound('Subject');
  const slug = input.slug ?? input.subjectSlug;
  const subject: Subject = { ...stored, name: input.name, examModes: input.examModes };
  if (slug === input.subjectSlug) return { class: toClassDto(await writeSubject(tx, schoolClass.id, slug, subject)) };
  if (Object.hasOwn(schoolClass.config.subjects, slug)) throw slugTakenError(locked, slug);
  await assertSubjectHasNoPlans(tx, locked, [input.subjectSlug], 'rename');
  const [updated] = await tx
    .update(classTable)
    .set({
      config: sql`jsonb_set(${classTable.config}, '{subjects}', (coalesce(${classTable.config} -> 'subjects', '{}'::jsonb) - ${input.subjectSlug}::text) || jsonb_build_object(${slug}::text, ${JSON.stringify(subject)}::jsonb))`,
      updatedAt: new Date(),
    })
    .where(eq(classTable.id, schoolClass.id))
    .returning();
  return { class: toClassDto(updated!) };
}

/**
 * Removes one subject of a class (`school.removeClassSubject`), leaving every
 * other subject as stored. Refused while the subject has any plan
 * ({@link assertSubjectHasNoPlans}): its plans would be left without a
 * subject.
 */
export async function removeClassSubject(tx: DatabaseTransaction, input: z.infer<typeof classSubjectInputSchema>) {
  const locked = await lockClassForSubjectChange(tx, input.schoolId, input.classId);
  const { schoolClass } = locked;
  if (!Object.hasOwn(schoolClass.config.subjects, input.subjectSlug)) throw rpcError.notFound('Subject');
  await assertSubjectHasNoPlans(tx, locked, [input.subjectSlug], 'remove');
  const [updated] = await tx
    .update(classTable)
    .set({
      config: sql`jsonb_set(${classTable.config}, '{subjects}', coalesce(${classTable.config} -> 'subjects', '{}'::jsonb) - ${input.subjectSlug}::text)`,
      updatedAt: new Date(),
    })
    .where(eq(classTable.id, schoolClass.id))
    .returning();
  return { class: toClassDto(updated!) };
}

/**
 * Makes an exam-only subject a classroom subject
 * (`school.moveClassSubjectToClassroom`). Its slug, plans and question
 * papers stay as they are; as a classroom subject it now gets a plan in
 * every other examination the class takes part in that can still change,
 * under the same permission rule as adding a classroom subject.
 */
export async function moveClassSubjectToClassroom(
  tx: DatabaseTransaction,
  input: z.infer<typeof classSubjectInputSchema>,
  permission: SubjectPlanPermission,
) {
  const locked = await lockClassForSubjectChange(tx, input.schoolId, input.classId);
  const { schoolClass } = locked;
  const stored = Object.hasOwn(schoolClass.config.subjects, input.subjectSlug) ? schoolClass.config.subjects[input.subjectSlug] : undefined;
  if (!stored) throw rpcError.notFound('Subject');
  if (stored.attachment.kind === 'school') throw rpcError.badRequest(`${stored.name} is already a classroom subject.`);
  const subject: Subject = { ...stored, attachment: { kind: 'school' } };
  const exams = await examsReceivingNewSubjects(tx, locked);
  const plans = await plansForNewSubjects(tx, schoolClass, exams, [[input.subjectSlug, subject]]);
  assertMayCreatePlans(schoolClass, plans, exams, permission);
  const updated = await writeSubject(tx, schoolClass.id, input.subjectSlug, subject);
  return { class: toClassDto(updated), createdPlans: await insertPlans(tx, plans) };
}

function sameAttachment(a: SubjectAttachment, b: SubjectAttachment) {
  if (a.kind === 'school' || b.kind === 'school') return a.kind === b.kind;
  return (
    a.exams.length === b.exams.length &&
    a.exams.every((exam) => b.exams.some((other) => other.sessionId === exam.sessionId && other.examSlug === exam.examSlug))
  );
}

/**
 * The stored form of a whole subject configuration sent by a caller
 * (`updateClassConfiguration`), given the stored one. Where a subject is
 * offered never changes here: an existing slug keeps its stored attachment
 * (sending it is allowed only unchanged), and a new slug is a classroom
 * subject (sending `{ kind: 'exam' }` for it is refused: exam-only subjects
 * are added with `addClassSubject`). Returns the new slugs and the stored
 * slugs the submission leaves out too.
 */
export function storedSubjects(
  submitted: ClassConfigSubmission['subjects'],
  stored: ClassConfig['subjects'],
): { subjects: ClassConfig['subjects']; added: string[]; removed: string[] } {
  const subjects: ClassConfig['subjects'] = {};
  const added: string[] = [];
  for (const [slug, subject] of Object.entries(submitted)) {
    const existing = Object.hasOwn(stored, slug) ? stored[slug] : undefined;
    if (existing && subject.attachment && !sameAttachment(subject.attachment, existing.attachment))
      throw rpcError.badRequest(
        `${subject.name}: where a subject is offered cannot be changed by saving the class configuration. Use moveClassSubjectToClassroom to make an exam-only subject a classroom subject.`,
      );
    if (!existing && subject.attachment && subject.attachment.kind !== 'school')
      throw rpcError.badRequest(`${subject.name}: add an exam-only subject with addClassSubject.`);
    if (!existing) added.push(slug);
    subjects[slug] = {
      name: subject.name,
      books: subject.books,
      examModes: subject.examModes,
      attachment: existing?.attachment ?? { kind: 'school' },
    };
  }
  const removed = Object.keys(stored).filter((slug) => !Object.hasOwn(submitted, slug));
  return { subjects, added, removed };
}

/**
 * The subjects of a new class (`createClass`, also the school's guided
 * setup): all classroom subjects. A new class takes part in no examination,
 * so an exam-only subject is refused (`addClassSubject` adds one later).
 */
export function newClassConfig(config: ClassConfigSubmission | undefined): ClassConfig {
  return { subjects: storedSubjects(config?.subjects ?? {}, {}).subjects };
}

/**
 * Replaces a class's attributes and/or whole subject configuration
 * (`school.updateClassConfiguration`, used by the assistant and other API
 * callers; the classroom screen changes one subject at a time). With a
 * configuration, the class is locked like any subject change, attachments
 * are kept ({@link storedSubjects}), every subject it adds is a classroom
 * subject that gets its plans like {@link addClassSubject} does, under the
 * same permission rule, and leaving out a subject that has plans is refused
 * ({@link assertSubjectHasNoPlans}). A whole configuration cannot say that a
 * subject was renamed, so a changed slug is a removal plus a new subject:
 * refused while the old slug has plans; `updateClassSubject` renames.
 */
export async function updateClassConfiguration(
  tx: DatabaseTransaction,
  input: z.infer<typeof updateClassConfigurationInputSchema>,
  permission: SubjectPlanPermission,
) {
  const { schoolId, classId, attributes, config } = input;
  if (!config) {
    const [updated] = await tx
      .update(classTable)
      .set({ attributes, updatedAt: new Date() })
      .where(and(eq(classTable.schoolId, schoolId), eq(classTable.id, classId)))
      .returning();
    if (!updated) throw rpcError.notFound('Class');
    return { class: toClassDto(updated), createdPlans: [] };
  }
  const locked = await lockClassForSubjectChange(tx, schoolId, classId);
  const { schoolClass } = locked;
  const { subjects, added, removed } = storedSubjects(config.subjects, schoolClass.config.subjects);
  await assertSubjectHasNoPlans(tx, locked, removed, 'remove');
  const exams = added.length ? await examsReceivingNewSubjects(tx, locked) : [];
  const plans = await plansForNewSubjects(
    tx,
    schoolClass,
    exams,
    added.map((slug) => [slug, subjects[slug]!] as const),
  );
  assertMayCreatePlans(schoolClass, plans, exams, permission);
  const [updated] = await tx
    .update(classTable)
    .set({ ...(attributes ? { attributes } : {}), config: { ...schoolClass.config, subjects }, updatedAt: new Date() })
    .where(eq(classTable.id, schoolClass.id))
    .returning();
  return { class: toClassDto(updated!), createdPlans: await insertPlans(tx, plans) };
}

/**
 * Removes examinations from the subjects attached to them, in the caller's
 * transaction, when the examinations are removed (`deleteExam`, an exam
 * removed or its slug changed in session settings, `deleteSession`). Each
 * matching subject loses those examinations from its `exams`; a subject left
 * with none is removed from its class. Plans never exist for such a subject
 * here: an examination with plans cannot be removed. `examSlugs` undefined
 * means every examination of the session (the session itself is deleted).
 *
 * The caller holds the session row FOR UPDATE; the class rows are locked
 * after it, in the order subject changes lock them.
 */
export async function detachExamsFromSubjects(
  tx: DatabaseExecutor,
  schoolId: string,
  sessionId: string,
  examSlugs?: readonly string[],
) {
  if (examSlugs && !examSlugs.length) return;
  const removed = (exam: SubjectExamRef) => exam.sessionId === sessionId && (!examSlugs || examSlugs.includes(exam.examSlug));
  const classes = await tx
    .select()
    .from(classTable)
    .where(
      and(
        eq(classTable.schoolId, schoolId),
        sql`jsonb_path_exists(${classTable.config}, '$.subjects.*.attachment.exams[*] ? (@.sessionId == $sessionId)', jsonb_build_object('sessionId', ${sessionId}::text))`,
      ),
    )
    .orderBy(asc(classTable.id))
    .for('update');
  for (const schoolClass of classes) {
    const subjects: ClassConfig['subjects'] = {};
    let changed = false;
    for (const [slug, subject] of Object.entries(schoolClass.config.subjects)) {
      if (subject.attachment.kind === 'school' || !subject.attachment.exams.some(removed)) {
        subjects[slug] = subject;
        continue;
      }
      changed = true;
      const exams = subject.attachment.exams.filter((exam) => !removed(exam));
      // `exams` holds exactly one examination today, so this always removes
      // the subject; written for a list so a later "use in another exam" keeps
      // the subject while any examination is left.
      if (exams.length) subjects[slug] = { ...subject, attachment: { kind: 'exam', exams } };
    }
    if (!changed) continue;
    await tx
      .update(classTable)
      .set({ config: { ...schoolClass.config, subjects }, updatedAt: new Date() })
      .where(eq(classTable.id, schoolClass.id));
  }
}
