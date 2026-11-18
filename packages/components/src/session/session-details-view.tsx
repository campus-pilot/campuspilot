'use client';

import { useState } from 'react';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Save,
  Undo2,
} from 'lucide-react';
import { AttendanceSection } from './attendance-section';
import { CoScholasticSection } from './co-scholastic-section';
import { ExaminationSection } from './examination-section';
import { GradingScaleSection } from './grading-scale-section';
import {
  SAVE_UNCERTAIN_MESSAGE,
  configsDiffer,
  sessionDraftState,
  type SessionEdits,
  type SessionSaveRefusal,
} from './session-draft-model';
import type {
  CoScholasticArea,
  ExamDefinition,
  GradeDefinition,
  SchoolSessionDto,
  SessionConfig,
  SessionSaveRequest,
  SessionSaveResult,
} from './types';

export interface SessionDetailsViewProps {
  session: SchoolSessionDto;
  isSaving?: boolean;
  /**
   * Saves the edited configuration and reports what became of it
   * (`SessionSaveResult`); the app makes the request, the view never calls
   * the API. The request carries the `updatedAt` of the session the edit was
   * started from (`basedOnUpdatedAt`), which the app must send as
   * `updateSession`'s `expectedUpdatedAt`. A rejected promise is shown as a
   * save whose outcome is unknown.
   */
  onSave?: (request: SessionSaveRequest) => Promise<SessionSaveResult>;
  onDirtyChange?: (isDirty: boolean) => void;
  onActivate?: () => void;
  isActivating?: boolean;
  /**
   * Whether to show the settings that only matter for students' results:
   * co-scholastic areas, the grading scale and attendance. The app passes
   * false for a school without student management, whose session only
   * defines its examinations. Hidden settings are kept as stored. Defaults to
   * true.
   */
  showStudentSettings?: boolean;
}

/**
 * The editing state of the settings view.
 *
 * With no edits the view shows the newest known session, so a refetch (an
 * exam created from the Examinations list, another save) shows at once.
 * The first edit pins the session it was made on (`basedOn`); the draft and
 * the dirty state are compared with that copy, not with later refetches, and
 * the save sends its `updatedAt`, so the server refuses the save as stale
 * instead of replacing what changed meanwhile.
 *
 * When the newest known session is newer than `basedOn` (`isOutdated`), or a
 * save was refused as stale or ended with an unknown outcome
 * (`refusal.reviewLatest`), the edits stay on screen, Save is unavailable
 * and the user loads the latest settings explicitly (`loadLatest`, which
 * discards the edits). The view does not replace the edits by itself: the
 * user decides when to give them up. Other refusals (a taken name, an exam
 * that cannot be removed, permission, a read-only school) are shown next to
 * Save and cleared by the next edit, so the user can correct and save again.
 */
function useSessionDraft(
  session: SchoolSessionDto,
  onSave: SessionDetailsViewProps['onSave'],
  onDirtyChange: SessionDetailsViewProps['onDirtyChange'],
) {
  const [edits, setEdits] = useState<SessionEdits | null>(null);
  const [lastSaved, setLastSaved] = useState<SchoolSessionDto | null>(null);
  const [refusal, setRefusal] = useState<SessionSaveRefusal | null>(null);

  const { basedOn, draft, isDirty, needsReview, message } = sessionDraftState({
    session,
    lastSaved,
    edits,
    refusal,
  });

  function applyEdit(next: SessionConfig) {
    const dirty = configsDiffer(next, basedOn.sessionConfig);
    setEdits(dirty ? { config: next, basedOn } : null);
    if (!refusal?.reviewLatest) setRefusal(null);
    onDirtyChange?.(dirty);
  }

  /** Drops the edits and shows the newest known session (Discard, Load latest settings). */
  function loadLatest() {
    setEdits(null);
    setRefusal(null);
    onDirtyChange?.(false);
  }

  async function save() {
    if (!onSave || !edits || !isDirty || needsReview) return;
    setRefusal(null);
    let result: SessionSaveResult;
    try {
      result = await onSave({
        sessionConfig: edits.config,
        basedOnUpdatedAt: edits.basedOn.updatedAt,
      });
    } catch {
      result = { status: 'refused', message: SAVE_UNCERTAIN_MESSAGE, reviewLatest: true };
    }
    if (result.status === 'saved') {
      setLastSaved(result.session);
      setEdits(null);
      onDirtyChange?.(false);
      return;
    }
    setRefusal({ message: result.message, reviewLatest: result.reviewLatest });
  }

  return { draft, isDirty, needsReview, message, applyEdit, loadLatest, save };
}

/**
 * The Save control, with Discard (or Load latest settings when the edit is
 * based on an outdated read) beside it and the save feedback under it.
 */
function SessionSaveToolbar({
  isDirty,
  isSaving,
  needsReview,
  message,
  onLoadLatest,
  onSave,
}: {
  isDirty: boolean;
  isSaving: boolean;
  needsReview: boolean;
  message: string | null;
  onLoadLatest: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5 self-end sm:self-auto">
      <div className="flex items-center gap-2">
        {needsReview ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={onLoadLatest}
          >
            <RefreshCw className="size-3.5" />
            Load latest settings
          </Button>
        ) : isDirty ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={onLoadLatest}
          >
            <Undo2 className="size-3.5" />
            Discard
          </Button>
        ) : null}
        <Button
          type="button"
          variant={isDirty && !needsReview ? 'default' : 'secondary'}
          size="sm"
          disabled={!isDirty || isSaving || needsReview}
          onClick={onSave}
        >
          {isSaving ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          {isSaving ? 'Saving changes…' : isDirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>
      {message ? (
        <p role="alert" className="max-w-md text-right text-xs text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Presentation and editing view for an academic session.
 * Renders the session status, save toolbar, and public academic configuration.
 * Finance is intentionally rendered by a separate permission-gated resource.
 */
export function SessionDetailsView({
  session,
  isSaving,
  onSave,
  onDirtyChange,
  onActivate,
  isActivating,
  showStudentSettings = true,
}: SessionDetailsViewProps) {
  // Historical sessions remain visible for reference, but all configuration
  // changes must go through the one session currently active for the school.
  const isEditable = session.isActive && onSave !== undefined;
  const { draft: draftSessionConfig, isDirty, needsReview, message, applyEdit, loadLatest, save } =
    useSessionDraft(session, onSave, onDirtyChange);

  function handleExamConfigChange(
    nextExamConfig: Record<string, ExamDefinition>,
  ) {
    applyEdit({
      examConfig: nextExamConfig,
      coScholasticAreas: draftSessionConfig?.coScholasticAreas ?? {},
      gradingScale: draftSessionConfig?.gradingScale ?? {},
      attendanceTracking: draftSessionConfig?.attendanceTracking ?? {
        enabled: false,
      },
    });
  }

  function handleCoScholasticChange(
    nextAreas: Record<string, CoScholasticArea>,
  ) {
    applyEdit({
      examConfig: draftSessionConfig?.examConfig ?? {},
      coScholasticAreas: nextAreas,
      gradingScale: draftSessionConfig?.gradingScale ?? {},
      attendanceTracking: draftSessionConfig?.attendanceTracking ?? {
        enabled: false,
      },
    });
  }

  function handleGradingScaleChange(
    nextScale: Record<string, GradeDefinition>,
  ) {
    applyEdit({
      examConfig: draftSessionConfig?.examConfig ?? {},
      coScholasticAreas: draftSessionConfig?.coScholasticAreas ?? {},
      gradingScale: nextScale,
      attendanceTracking: draftSessionConfig?.attendanceTracking ?? {
        enabled: false,
      },
    });
  }

  function handleAttendanceChange(enabled: boolean) {
    applyEdit({
      examConfig: draftSessionConfig?.examConfig ?? {},
      coScholasticAreas: draftSessionConfig?.coScholasticAreas ?? {},
      gradingScale: draftSessionConfig?.gradingScale ?? {},
      attendanceTracking: { enabled },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Session Page Header: Title, Active Status & Save Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Academic Session {session.sessionStartYear}&ndash;{session.sessionEndYear}
          </h1>

          {session.isActive ? (
            <Badge
              variant="outline"
              className="border-emerald-500/30 text-[10px] text-emerald-600 dark:text-emerald-400"
            >
              Active
            </Badge>
          ) : onActivate ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={isActivating}
              onClick={onActivate}
            >
              {isActivating ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3 text-emerald-600" />
              )}
              Set as active
            </Button>
          ) : null}
        </div>

        {isEditable ? (
          <SessionSaveToolbar
            isDirty={isDirty}
            isSaving={isSaving ?? false}
            needsReview={needsReview}
            message={message}
            onLoadLatest={loadLatest}
            onSave={() => void save()}
          />
        ) : null}
      </div>

      {!session.isActive ? (
        <p className="text-sm text-muted-foreground">
          Inactive sessions are read-only. Set this session as active to edit
          its configuration.
        </p>
      ) : null}

      {/* 1. Examinations */}
      <ExaminationSection
        examConfig={draftSessionConfig?.examConfig}
        onChange={isEditable ? handleExamConfigChange : undefined}
      />

      {showStudentSettings ? (
        <>
          {/* 2. Co-scholastics (ECA) */}
          <CoScholasticSection
            areas={draftSessionConfig?.coScholasticAreas}
            onChange={isEditable ? handleCoScholasticChange : undefined}
          />

          {/* 3. Grading Scale */}
          <GradingScaleSection
            gradingScale={draftSessionConfig?.gradingScale}
            onChange={isEditable ? handleGradingScaleChange : undefined}
          />

          {/* 4. Attendance */}
          <AttendanceSection
            enabled={draftSessionConfig?.attendanceTracking?.enabled ?? false}
            onChange={isEditable ? handleAttendanceChange : undefined}
          />
        </>
      ) : null}
    </div>
  );
}
