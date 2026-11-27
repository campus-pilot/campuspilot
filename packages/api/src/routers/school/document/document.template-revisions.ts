import type { DatabaseExecutor } from "@campuspilot/db";
import { artifactTable, schoolDocumentTemplateTable } from "@campuspilot/db/schema/artifact";
import { user } from "@campuspilot/db/schema/auth";
import { and, count, desc, eq, sql } from "drizzle-orm";

import { rpcError } from "../../../errors";
import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from "../../../paginations";
import type * as dto from "./document.dto";
import { readDocumentTemplate } from "./document.storage";

type TemplateScope = { schoolId: string; documentType: dto.TemplateDocumentType };

/** The type's template revisions: every ready `template` artifact of the school and type. */
const revisionsOf = (scope: TemplateScope) =>
  and(
    eq(artifactTable.schoolId, scope.schoolId),
    eq(artifactTable.documentType, scope.documentType),
    eq(artifactTable.kind, "template"),
    eq(artifactTable.status, "ready"),
  );

/**
 * The type's revisions numbered oldest first (creation time, then id for a
 * tie), as a subquery: the number is a label for people ("Revision 3"), the
 * id is what identifies one.
 */
function numberedRevisions(db: DatabaseExecutor, scope: TemplateScope) {
  return db
    .select({
      id: artifactTable.id,
      name: artifactTable.name,
      pageSize: artifactTable.pageSize,
      marketplaceSlug: artifactTable.marketplaceSlug,
      createdAt: artifactTable.createdAt,
      createdBy: artifactTable.createdBy,
      s3Key: artifactTable.s3Key,
      revisionNo: sql<number>`row_number() over (order by ${artifactTable.createdAt}, ${artifactTable.id})`.mapWith(Number).as("revision_no"),
    })
    .from(artifactTable)
    .where(revisionsOf(scope))
    .as("numbered_revision");
}

async function selectedRevisionId(db: DatabaseExecutor, scope: TemplateScope): Promise<string | null> {
  const [selection] = await db
    .select({ artifactId: schoolDocumentTemplateTable.artifactId })
    .from(schoolDocumentTemplateTable)
    .where(and(eq(schoolDocumentTemplateTable.schoolId, scope.schoolId), eq(schoolDocumentTemplateTable.documentType, scope.documentType)))
    .limit(1);
  return selection?.artifactId ?? null;
}

type NumberedRow = {
  id: string;
  name: string;
  pageSize: dto.DocumentTemplatePageSize;
  marketplaceSlug: string | null;
  createdAt: Date;
  revisionNo: number;
  createdByName: string | null;
};

const toRevision = (row: NumberedRow, selectedId: string | null): dto.TemplateRevision => ({
  revisionId: row.id,
  revisionNo: row.revisionNo,
  name: row.name,
  pageSize: row.pageSize,
  marketplaceSlug: row.marketplaceSlug,
  createdAt: row.createdAt.toISOString(),
  createdByName: row.createdByName,
  selected: row.id === selectedId,
});

/**
 * One page of the school's revisions of a template type, newest first. Every
 * save and every marketplace import is a revision; none is ever changed or
 * removed (docs/document-system.md), so the history is the whole lifecycle.
 */
export async function listTemplateRevisions(
  db: DatabaseExecutor,
  input: TemplateScope & { cursor?: string; page?: number; limit: number },
) {
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const numbered = numberedRevisions(db, input);
  const [rows, [total], selectedId] = await Promise.all([
    db
      .select({
        id: numbered.id,
        name: numbered.name,
        pageSize: numbered.pageSize,
        marketplaceSlug: numbered.marketplaceSlug,
        createdAt: numbered.createdAt,
        revisionNo: numbered.revisionNo,
        createdByName: user.name,
      })
      .from(numbered)
      .leftJoin(user, eq(user.id, numbered.createdBy))
      .orderBy(desc(numbered.revisionNo))
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(artifactTable).where(revisionsOf(input)),
    selectedRevisionId(db, input),
  ]);
  const totalItems = total?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({
    items: rows.map((row) => toRevision(row, selectedId)),
    totalItems,
    currentPage,
    pageSize,
    totalPages,
    nextCursor: createNextPageCursor(currentPage, totalPages),
  });
}

/**
 * One revision with its source, read from its immutable object. A revision
 * of another school or type, a generated PDF's id, or an unknown id is
 * NOT_FOUND alike, so an id from elsewhere reveals nothing.
 */
export async function getTemplateRevision(db: DatabaseExecutor, input: TemplateScope & { revisionId: string }) {
  const numbered = numberedRevisions(db, input);
  const [[row], selectedId] = await Promise.all([
    db
      .select({
        id: numbered.id,
        name: numbered.name,
        pageSize: numbered.pageSize,
        marketplaceSlug: numbered.marketplaceSlug,
        createdAt: numbered.createdAt,
        revisionNo: numbered.revisionNo,
        s3Key: numbered.s3Key,
        createdByName: user.name,
      })
      .from(numbered)
      .leftJoin(user, eq(user.id, numbered.createdBy))
      .where(eq(numbered.id, input.revisionId))
      .limit(1),
    selectedRevisionId(db, input),
  ]);
  if (!row) throw rpcError.notFound("Template revision");
  return { revision: toRevision(row, selectedId), content: await readDocumentTemplate(row.s3Key) };
}
