'use client';

import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type {
  AssistantExamResultView,
  AssistantRecordEntity,
  AssistantView,
} from '@campuspilot/assistant-contract/views';
import {
  AssistantBarsViewBlock,
  AssistantDetailsViewBlock,
  AssistantNoticeViewBlock,
  AssistantRecordList,
  AssistantStatsViewBlock,
  AssistantTableViewBlock,
  AssistantViewFrame,
} from '@campuspilot/components/assistant';
import { StudentExamPreview } from '@campuspilot/components/exam/student-exam-preview';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';

import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';

import { AssistantDocumentsViewBlock } from './assistant-document-views';
import { AssistantQuestionPaperViewBlock } from './assistant-question-paper';
import { AssistantRecordsViewBlock, AssistantRecordsViewPlaceholder } from './assistant-record-views';
import { retryUnlessRefused } from './assistant-stream';

/** The read permission the API checks for each record type. */
function recordPermission(entity: AssistantRecordEntity, schoolId: string) {
  const resource = { kind: 'school' as const, schoolId };
  switch (entity) {
    case 'admission':
      return { action: SCHOOL_ACTIONS.READ_ADMISSION, resource };
    case 'student':
      return { action: SCHOOL_ACTIONS.READ_STUDENT, resource };
    case 'class':
      return { action: SCHOOL_ACTIONS.READ_CLASS, resource };
    case 'exam':
      return { action: SCHOOL_ACTIONS.READ_EXAMS, resource };
    case 'staff':
      return { action: SCHOOL_ACTIONS.READ_MEMBER, resource };
  }
}

function NotAvailable({ title }: { title?: string }) {
  return (
    <AssistantViewFrame title={title}>
      <p className="text-sm text-muted-foreground">You don’t have access to these records.</p>
    </AssistantViewFrame>
  );
}

/** A result still loading, or its permission check: the shape it will take. */
function ExamResultPlaceholder({ title }: { title?: string }) {
  return (
    <AssistantViewFrame title={title}>
      <Skeleton className="h-40 w-full rounded-lg" />
    </AssistantViewFrame>
  );
}

/** Document rows while the permission to read documents is being checked. */
function DocumentsPlaceholder({ title, count }: { title?: string; count: number }) {
  return <AssistantRecordList title={title} records={[]} loadingCount={count} renderLink={() => null} />;
}

function ExamResultBlock({ schoolId, view }: { schoolId: string; view: AssistantExamResultView }) {
  const result = useQuery({
    ...orpc.school.getStudentExam.queryOptions({
      input: {
        schoolId,
        sessionId: view.sessionId,
        examSlug: view.examSlug,
        classId: view.classId,
        studentId: view.studentId,
      },
    }),
    // A result that is gone or not allowed says so at once instead of loading through retries.
    retry: retryUnlessRefused,
  });
  if (result.isPending) return <ExamResultPlaceholder title={view.title} />;
  return (
    <AssistantViewFrame title={view.title}>
      {result.data ? (
        <StudentExamPreview data={result.data} />
      ) : (
        <p className="text-sm text-muted-foreground">This result is not available.</p>
      )}
    </AssistantViewFrame>
  );
}

/**
 * Renders a view the assistant showed, with the app's own components. Every
 * record and result is fetched here with the user's session, behind the same
 * permission the API enforces. While that permission is being checked a view
 * shows its loading shape, not the "no access" message it may never need.
 */
export function AssistantViewBlock({ schoolId, view }: { schoolId: string; view: AssistantView }) {
  const resource = { kind: 'school' as const, schoolId };
  switch (view.type) {
    case 'table':
      return <AssistantTableViewBlock view={view} />;
    case 'stats':
      return <AssistantStatsViewBlock view={view} />;
    case 'details':
      return <AssistantDetailsViewBlock view={view} />;
    case 'bars':
      return <AssistantBarsViewBlock view={view} />;
    case 'notice':
      return <AssistantNoticeViewBlock view={view} />;
    case 'records':
      return (
        <RequirePermissions
          permissions={recordPermission(view.entity, schoolId)}
          fallback={<NotAvailable title={view.title} />}
          pending={<AssistantRecordsViewPlaceholder view={view} />}
        >
          <AssistantRecordsViewBlock schoolId={schoolId} view={view} />
        </RequirePermissions>
      );
    case 'documents':
      return (
        <RequirePermissions
          permissions={{ action: SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS, resource }}
          fallback={<NotAvailable title={view.title} />}
          pending={<DocumentsPlaceholder title={view.title} count={view.documents.length} />}
        >
          <AssistantDocumentsViewBlock schoolId={schoolId} view={view} />
        </RequirePermissions>
      );
    case 'question_paper':
      return <AssistantQuestionPaperViewBlock schoolId={schoolId} view={view} />;
    case 'exam_result':
      return (
        <RequirePermissions
          permissions={[
            { action: SCHOOL_ACTIONS.READ_EXAMS, resource },
            { action: SCHOOL_ACTIONS.READ_EXAM_RESULTS, resource },
          ]}
          fallback={<NotAvailable title={view.title} />}
          pending={<ExamResultPlaceholder title={view.title} />}
        >
          <ExamResultBlock schoolId={schoolId} view={view} />
        </RequirePermissions>
      );
  }
}
