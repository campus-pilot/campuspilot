'use client';
import Link from 'next/link';
import { Files } from 'lucide-react';
import type { DocumentType } from '@campuspilot/api/routers/school/document/document.dto';
import { DocumentButton } from '@campuspilot/components/documents/document-controls';
import { RequirePermissions } from '@/components/require-permissions';
import {
  documentPermission,
  SCHOOL_ACTIONS,
  type DocumentScope,
} from './document-common';

/** Exporting and reading each source are separate permissions. The selector
 * additionally lists classes/students, so those grants are checked explicitly.
 */
export function documentWorkspacePermissions(
  schoolId: string,
  type: DocumentType,
) {
  const source =
    type === 'timetable'
      ? [SCHOOL_ACTIONS.READ_EXAM_TIMETABLE]
      : type === 'id_card'
        ? [SCHOOL_ACTIONS.READ_STUDENT, SCHOOL_ACTIONS.LIST_STUDENTS]
        : type === 'report_card'
          ? [
              SCHOOL_ACTIONS.READ_STUDENT,
              SCHOOL_ACTIONS.LIST_STUDENTS,
              SCHOOL_ACTIONS.READ_EXAM_RESULTS,
            ]
          : [
              SCHOOL_ACTIONS.READ_STUDENT,
              SCHOOL_ACTIONS.LIST_STUDENTS,
              SCHOOL_ACTIONS.READ_EXAM_TIMETABLE,
            ];
  return [
    SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES,
    SCHOOL_ACTIONS.GENERATE_DOCUMENTS,
    SCHOOL_ACTIONS.READ_SESSION,
    SCHOOL_ACTIONS.READ_CLASS,
    SCHOOL_ACTIONS.LIST_CLASSES,
    ...(type === 'id_card' ? [] : [SCHOOL_ACTIONS.READ_EXAMS]),
    ...(type === 'report_card' ? [SCHOOL_ACTIONS.READ_EXAM_PLANS] : []),
    ...source,
  ].map((action) => documentPermission(schoolId, action));
}
export function DocumentExportLink({
  scope,
  type,
  classId,
  examSlug,
  studentId,
  label = 'Create PDF',
}: {
  scope: DocumentScope;
  type: DocumentType;
  classId?: string;
  examSlug?: string;
  studentId?: string;
  label?: string;
}) {
  const href = documentWorkspaceHref({
    scope,
    type,
    classId,
    examSlug,
    studentId,
  });
  return (
    <RequirePermissions
      permissions={documentWorkspacePermissions(scope.schoolId, type)}
    >
      <DocumentButton asChild variant="outline">
        <Link href={href}>
          <Files />
          {label}
        </Link>
      </DocumentButton>
    </RequirePermissions>
  );
}

/** Keeps contextual document links consistent across buttons and action menus. */
export function documentWorkspaceHref({
  scope,
  type,
  classId,
  examSlug,
  studentId,
}: {
  scope: DocumentScope;
  type: DocumentType;
  classId?: string;
  examSlug?: string;
  studentId?: string;
}) {
  // A timetable is an examination-wide grid. Contextual class links may reuse
  // this helper, but they must never turn a timetable into a class export.
  const query = new URLSearchParams({
    type,
    ...(classId && type !== 'timetable' ? { classId } : {}),
    ...(examSlug ? { examSlug } : {}),
    ...(studentId ? { studentId } : {}),
  });
  return `/school/${encodeURIComponent(scope.schoolId)}/sessions/${encodeURIComponent(scope.sessionId)}/documents?${query}`;
}
