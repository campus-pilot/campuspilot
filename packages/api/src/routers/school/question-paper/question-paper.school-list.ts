import type { DatabaseExecutor } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { classTable } from '@campuspilot/db/schema/class';
import { examQuestionPaperTable } from '@campuspilot/db/schema/exam-question-paper';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../../../paginations';
import { paperListFactsOf } from './question-paper.list-facts';
import { examKeyPart } from './question-paper.records';
import type { StandalonePaperReach } from './question-paper.scope';
import type {
  listSchoolQuestionPaperFilterOptionsOutputSchema,
  listSchoolQuestionPapersInputSchema,
  listSchoolQuestionPapersOutputSchema,
  SchoolQuestionPaperFilters,
} from './question-paper.school-list.dto';

/**
 * A school's Question papers page (docs/question-papers.md "The Question
 * papers page"): the session's exam papers and quick papers in one list, read
 * in one query so search, filters, order and pages are the database's.
 *
 * What the caller sees is two separate grants, each decided by the procedure
 * and passed in: `exam`, the classes whose exam papers they may read
 * (`class.exam.question_paper.read`, null when they may not read exam plans
 * at all); `quick`, their reach over the school's quick papers
 * (`StandalonePaperReach`, null without `school.standalone_paper.read`).
 */
export type SchoolQuestionPaperAccess = {
  exam: { classIds: readonly string[] } | null;
  quick: StandalonePaperReach | null;
};

const paper = examQuestionPaperTable;

/**
 * The names a row shows, as SQL: an exam paper's from its plan's sources (the
 * examination's name in the session's configuration, the class label, the
 * subject's and mode's names in the class configuration; the slug when a name
 * is missing, as `resolvePaperScope` does), a quick paper's from its details.
 * The JSON keys are bound parameters of the row's own slugs, never text.
 */
const examNameSql = sql<string | null>`case when ${paper.kind} = 'exam' then coalesce(${schoolSessionTable.sessionConfig} -> 'examConfig' -> ${paper.examSlug} ->> 'name', ${paper.examSlug}) else ${paper.detailsExamName} end`;
const classNameSql = sql<string | null>`case when ${paper.kind} = 'exam' then ${classTable.label} else ${paper.detailsClassName} end`;
const subjectNameSql = sql<string | null>`case when ${paper.kind} = 'exam' then coalesce(${classTable.config} -> 'subjects' -> ${paper.subjectSlug} ->> 'name', ${paper.subjectSlug}) else ${paper.detailsSubjectName} end`;
const modeNameSql = sql<string | null>`case when ${paper.kind} = 'exam' then coalesce(${classTable.config} -> 'subjects' -> ${paper.subjectSlug} -> 'examModes' -> ${paper.modeSlug} ->> 'name', ${paper.modeSlug}) else null end`;

/** Escapes `%`, `_` and `\` so a search term matches literally. */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

/**
 * The papers of the session the caller may see, before any filter: exam
 * papers of the classes they may read, and quick papers they reach (their
 * own, or every one with `oversee`). False (nothing) when they have neither.
 */
function visibleWhere(input: { schoolId: string; sessionId: string }, access: SchoolQuestionPaperAccess): SQL {
  const exam = access.exam && access.exam.classIds.length > 0 ? and(eq(paper.kind, 'exam'), inArray(paper.classId, [...access.exam.classIds])) : undefined;
  const quick = access.quick
    ? and(eq(paper.kind, 'standalone'), access.quick.oversee ? undefined : eq(paper.createdBy, access.quick.userId))
    : undefined;
  const either = exam && quick ? or(exam, quick) : (exam ?? quick);
  return and(eq(paper.schoolId, input.schoolId), eq(paper.sessionId, input.sessionId), either ?? sql`false`)!;
}

/** The filters as SQL; see `schoolQuestionPaperFiltersSchema` for what each means, the default status rule included. */
function filterWhere(filters: SchoolQuestionPaperFilters, searchQuery: string): SQL | undefined {
  const clauses: (SQL | undefined)[] = [
    filters.type === 'exam' ? eq(paper.kind, 'exam') : filters.type === 'quick' ? eq(paper.kind, 'standalone') : undefined,
    filters.status === 'generated'
      ? gt(paper.latestVersionNo, 0)
      : filters.status === 'not_generated'
        ? eq(paper.latestVersionNo, 0)
        : or(eq(paper.kind, 'standalone'), gt(paper.latestVersionNo, 0)),
    filters.examName === undefined ? undefined : sql`${examNameSql} = ${filters.examName}`,
    filters.className === undefined ? undefined : sql`${classNameSql} = ${filters.className}`,
    filters.subjectName === undefined ? undefined : sql`${subjectNameSql} = ${filters.subjectName}`,
    searchQuery
      ? or(
          ilike(examNameSql, likePattern(searchQuery)),
          ilike(classNameSql, likePattern(searchQuery)),
          ilike(subjectNameSql, likePattern(searchQuery)),
          ilike(paper.detailsSchoolName, likePattern(searchQuery)),
        )
      : undefined,
  ];
  return and(...clauses);
}

/**
 * `listSchoolQuestionPapers`: one page of the session's papers the caller may
 * see, most recently changed first (`updated_at`, then id), with the names the
 * row shows and the activity facts of each.
 */
export async function listSchoolQuestionPapers(
  db: DatabaseExecutor,
  input: z.infer<typeof listSchoolQuestionPapersInputSchema>,
  access: SchoolQuestionPaperAccess,
): Promise<z.infer<typeof listSchoolQuestionPapersOutputSchema>> {
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const where = and(visibleWhere(input, access), filterWhere(input.filters, input.searchQuery));
  // The class and session an exam paper's names come from, both held to the paper's school.
  const classJoin = and(eq(classTable.id, paper.classId), eq(classTable.schoolId, paper.schoolId));
  const sessionJoin = and(eq(schoolSessionTable.id, paper.sessionId), eq(schoolSessionTable.schoolId, paper.schoolId));
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: paper.id,
        kind: paper.kind,
        examSlug: paper.examSlug,
        classId: paper.classId,
        subjectSlug: paper.subjectSlug,
        modeSlug: paper.modeSlug,
        latestVersionNo: paper.latestVersionNo,
        createdAt: paper.createdAt,
        updatedAt: paper.updatedAt,
        examName: examNameSql,
        className: classNameSql,
        subjectName: subjectNameSql,
        modeName: modeNameSql,
        createdByName: user.name,
      })
      .from(paper)
      .leftJoin(classTable, classJoin)
      .leftJoin(schoolSessionTable, sessionJoin)
      .leftJoin(user, eq(user.id, paper.createdBy))
      .where(where)
      .orderBy(desc(paper.updatedAt), desc(paper.id))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(paper).leftJoin(classTable, classJoin).leftJoin(schoolSessionTable, sessionJoin).where(where),
  ]);
  const totalItems = total?.count ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  const factsOf = await paperListFactsOf(db, rows.map((row) => row.id));
  return createPaginatedResult({
    items: rows.map((row) => {
      const facts = factsOf(row.id);
      const exam = row.kind === 'exam';
      return {
        paperId: row.id,
        type: exam ? ('exam' as const) : ('quick' as const),
        subjectName: row.subjectName,
        className: row.className,
        examName: row.examName,
        modeName: row.modeName,
        examKey: exam
          ? { examSlug: examKeyPart(row.examSlug), classId: examKeyPart(row.classId), subjectSlug: examKeyPart(row.subjectSlug), modeSlug: examKeyPart(row.modeSlug) }
          : null,
        latestVersionNo: row.latestVersionNo,
        pageCount: facts.pageCount,
        warningCount: facts.warningCount,
        activeJob: facts.activeJob,
        lastJobFailure: facts.lastJobFailure,
        createdByName: row.createdByName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),
    nextCursor: createNextPageCursor(currentPage, totalPages),
    currentPage,
    totalPages,
    totalItems,
    pageSize,
  });
}

/** The most values each filter offers. */
const FILTER_OPTIONS_LIMIT = 200;

/**
 * `listSchoolQuestionPaperFilterOptions`: the distinct exam, class and subject
 * names of every paper of the session the caller may see (generated or not),
 * each sorted.
 */
export async function listSchoolQuestionPaperFilterOptions(
  db: DatabaseExecutor,
  input: { schoolId: string; sessionId: string },
  access: SchoolQuestionPaperAccess,
): Promise<z.infer<typeof listSchoolQuestionPaperFilterOptionsOutputSchema>> {
  const where = visibleWhere(input, access);
  const optionsOf = async (column: SQL<string | null>) => {
    const rows = await db
      .selectDistinct({ value: column })
      .from(paper)
      .leftJoin(classTable, and(eq(classTable.id, paper.classId), eq(classTable.schoolId, paper.schoolId)))
      .leftJoin(schoolSessionTable, and(eq(schoolSessionTable.id, paper.sessionId), eq(schoolSessionTable.schoolId, paper.schoolId)))
      .where(and(where, isNotNull(column)))
      .orderBy(asc(column))
      .limit(FILTER_OPTIONS_LIMIT);
    return rows.map((row) => row.value).filter((value): value is string => value !== null);
  };
  const [examNames, classNames, subjectNames] = await Promise.all([optionsOf(examNameSql), optionsOf(classNameSql), optionsOf(subjectNameSql)]);
  return { examNames, classNames, subjectNames };
}

/** The classes of the session's exam papers, whose read permission decides which exam papers the caller sees. */
export async function examPaperClassIdsOf(db: DatabaseExecutor, input: { schoolId: string; sessionId: string }): Promise<string[]> {
  const rows = await db
    .selectDistinct({ classId: paper.classId })
    .from(paper)
    .where(and(eq(paper.schoolId, input.schoolId), eq(paper.sessionId, input.sessionId), eq(paper.kind, 'exam')));
  return rows.map((row) => examKeyPart(row.classId));
}
