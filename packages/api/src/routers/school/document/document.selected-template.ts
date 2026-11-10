import type { DatabaseExecutor } from "@campuspilot/db";
import {
  artifactTable,
  schoolDocumentTemplateTable,
} from "@campuspilot/db/schema/artifact";
import { and, eq, inArray } from "drizzle-orm";

import { rpcError } from "../../../errors";
import type * as dto from "./document.dto";
import { readDocumentTemplate } from "./document.storage";

/**
 * The school's selected (active) template revision of a document type with
 * its source. Throws NOT_FOUND when none is selected and CONFLICT when the
 * caller reviewed a different revision.
 */
export async function getSelectedDocumentTemplate(
  db: DatabaseExecutor,
  input: { schoolId: string; documentType: dto.DocumentType },
  revision?: string,
) {
  const [selected] = await db
    .select({ artifact: artifactTable })
    .from(schoolDocumentTemplateTable)
    .innerJoin(
      artifactTable,
      and(
        eq(artifactTable.id, schoolDocumentTemplateTable.artifactId),
        eq(artifactTable.schoolId, input.schoolId),
        eq(artifactTable.documentType, input.documentType),
        eq(artifactTable.kind, "template"),
        eq(artifactTable.status, "ready"),
      ),
    )
    .where(
      and(
        eq(schoolDocumentTemplateTable.schoolId, input.schoolId),
        eq(schoolDocumentTemplateTable.documentType, input.documentType),
      ),
    )
    .limit(1);
  if (!selected) throw rpcError.notFound("Configured document template");
  if (revision && selected.artifact.id !== revision)
    throw rpcError.conflict(
      "The template changed. Refresh the template and preview again.",
    );
  return {
    row: selected.artifact,
    content: await readDocumentTemplate(selected.artifact.s3Key),
  };
}

/**
 * Which of the given document types have a selected, ready template revision
 * in the school (one query; used to decide whether a PDF can be produced).
 */
export async function selectedDocumentTemplateTypes(
  db: DatabaseExecutor,
  schoolId: string,
  documentTypes: readonly dto.DocumentType[],
): Promise<Set<dto.DocumentType>> {
  if (documentTypes.length === 0) return new Set();
  const rows = await db
    .select({ documentType: schoolDocumentTemplateTable.documentType })
    .from(schoolDocumentTemplateTable)
    .innerJoin(
      artifactTable,
      and(
        eq(artifactTable.id, schoolDocumentTemplateTable.artifactId),
        eq(artifactTable.schoolId, schoolId),
        eq(artifactTable.kind, "template"),
        eq(artifactTable.status, "ready"),
      ),
    )
    .where(
      and(
        eq(schoolDocumentTemplateTable.schoolId, schoolId),
        inArray(schoolDocumentTemplateTable.documentType, [...documentTypes]),
      ),
    );
  return new Set(rows.map((row) => row.documentType as dto.DocumentType));
}
