'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  CheckCircle2,
  LoaderCircle,
  Save,
  Undo2,
} from 'lucide-react';
import { AttendanceSection } from './attendance-section';
import { CoScholasticSection } from './co-scholastic-section';
import { ExaminationSection } from './examination-section';
import { FinanceSection } from './finance-section';
import { GradingScaleSection } from './grading-scale-section';
import type {
  CoScholasticArea,
  ExamDefinition,
  FinanceSchemaConfig,
  GradeDefinition,
  SchoolSessionDto,
  SessionConfig,
} from './types';

export interface SessionDetailsViewProps {
  session: SchoolSessionDto;
  isSaving?: boolean;
  onSave?: (updates: {
    sessionConfig: SessionConfig | null;
    financeConfig: FinanceSchemaConfig | null;
  }) => Promise<void> | void;
  onDirtyChange?: (isDirty: boolean) => void;
  onActivate?: () => void;
  isActivating?: boolean;
}

/**
 * Normalizes session config ensuring undefined records become null/empty
 * to allow stable equality comparisons.
 */
function normalizeSessionConfig(config: SessionConfig | null | undefined) {
  if (!config) return null;
  return {
    examConfig: config.examConfig ?? {},
    coScholasticAreas: config.coScholasticAreas ?? {},
    gradingScale: config.gradingScale ?? {},
    attendanceTracking: config.attendanceTracking ?? { enabled: false },
  };
}

/**
 * Presentation and editing view for an academic session.
 * Renders the top session status & save toolbar followed by the 5 core sections:
 * Examinations, Co-scholastics, Grading Scale, Attendance, and Finance.
 */
export function SessionDetailsView({
  session,
  isSaving,
  onSave,
  onDirtyChange,
  onActivate,
  isActivating,
}: SessionDetailsViewProps) {
  const [draftSessionConfig, setDraftSessionConfig] = useState<SessionConfig | null>(
    () => session.sessionConfig,
  );
  const [draftFinanceConfig, setDraftFinanceConfig] =
    useState<FinanceSchemaConfig | null>(() => session.financeConfig);

  function computeDirty(
    nextSession: SessionConfig | null,
    nextFinance: FinanceSchemaConfig | null,
  ) {
    const originalSessionNormalized = normalizeSessionConfig(
      session.sessionConfig,
    );
    const draftSessionNormalized = normalizeSessionConfig(nextSession);
    const sessionConfigChanged =
      JSON.stringify(originalSessionNormalized) !==
      JSON.stringify(draftSessionNormalized);

    const financeConfigChanged =
      JSON.stringify(session.financeConfig) !== JSON.stringify(nextFinance);

    return sessionConfigChanged || financeConfigChanged;
  }

  // Compute dirty status by serializing the drafts against baseline props
  const isDirty = useMemo(() => {
    return computeDirty(draftSessionConfig, draftFinanceConfig);
  }, [
    session.sessionConfig,
    session.financeConfig,
    draftSessionConfig,
    draftFinanceConfig,
  ]);

  function notifyDirty(
    nextSession: SessionConfig | null,
    nextFinance: FinanceSchemaConfig | null,
  ) {
    onDirtyChange?.(computeDirty(nextSession, nextFinance));
  }

  function handleReset() {
    setDraftSessionConfig(session.sessionConfig);
    setDraftFinanceConfig(session.financeConfig);
    onDirtyChange?.(false);
  }

  function handleExamConfigChange(
    nextExamConfig: Record<string, ExamDefinition>,
  ) {
    const nextSession: SessionConfig = {
      examConfig: nextExamConfig,
      coScholasticAreas: draftSessionConfig?.coScholasticAreas ?? {},
      gradingScale: draftSessionConfig?.gradingScale ?? {},
      attendanceTracking: draftSessionConfig?.attendanceTracking ?? {
        enabled: false,
      },
    };
    setDraftSessionConfig(nextSession);
    notifyDirty(nextSession, draftFinanceConfig);
  }

  function handleCoScholasticChange(
    nextAreas: Record<string, CoScholasticArea>,
  ) {
    const nextSession: SessionConfig = {
      examConfig: draftSessionConfig?.examConfig ?? {},
      coScholasticAreas: nextAreas,
      gradingScale: draftSessionConfig?.gradingScale ?? {},
      attendanceTracking: draftSessionConfig?.attendanceTracking ?? {
        enabled: false,
      },
    };
    setDraftSessionConfig(nextSession);
    notifyDirty(nextSession, draftFinanceConfig);
  }

  function handleGradingScaleChange(
    nextScale: Record<string, GradeDefinition>,
  ) {
    const nextSession: SessionConfig = {
      examConfig: draftSessionConfig?.examConfig ?? {},
      coScholasticAreas: draftSessionConfig?.coScholasticAreas ?? {},
      gradingScale: nextScale,
      attendanceTracking: draftSessionConfig?.attendanceTracking ?? {
        enabled: false,
      },
    };
    setDraftSessionConfig(nextSession);
    notifyDirty(nextSession, draftFinanceConfig);
  }

  function handleAttendanceChange(enabled: boolean) {
    const nextSession: SessionConfig = {
      examConfig: draftSessionConfig?.examConfig ?? {},
      coScholasticAreas: draftSessionConfig?.coScholasticAreas ?? {},
      gradingScale: draftSessionConfig?.gradingScale ?? {},
      attendanceTracking: { enabled },
    };
    setDraftSessionConfig(nextSession);
    notifyDirty(nextSession, draftFinanceConfig);
  }

  function handleFinanceChange(nextFinance: FinanceSchemaConfig | null) {
    setDraftFinanceConfig(nextFinance);
    notifyDirty(draftSessionConfig, nextFinance);
  }

  async function handleSubmitSave() {
    if (!onSave) return;
    await onSave({
      sessionConfig: draftSessionConfig,
      financeConfig: draftFinanceConfig,
    });
    onDirtyChange?.(false);
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

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {isDirty ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSaving}
              onClick={handleReset}
            >
              <Undo2 className="size-3.5" />
              Discard
            </Button>
          ) : null}
          <Button
            type="button"
            variant={isDirty ? 'default' : 'secondary'}
            size="sm"
            disabled={!isDirty || isSaving}
            onClick={handleSubmitSave}
          >
            {isSaving ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {isSaving ? 'Saving changes…' : isDirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </div>

      {/* 1. Examinations */}
      <ExaminationSection
        examConfig={draftSessionConfig?.examConfig}
        onChange={handleExamConfigChange}
      />

      {/* 2. Co-scholastics (ECA) */}
      <CoScholasticSection
        areas={draftSessionConfig?.coScholasticAreas}
        onChange={handleCoScholasticChange}
      />

      {/* 3. Grading Scale */}
      <GradingScaleSection
        gradingScale={draftSessionConfig?.gradingScale}
        onChange={handleGradingScaleChange}
      />

      {/* 4. Attendance */}
      <AttendanceSection
        enabled={draftSessionConfig?.attendanceTracking?.enabled ?? false}
        onChange={handleAttendanceChange}
      />

      {/* 5. Finance */}
      <FinanceSection
        financeConfig={draftFinanceConfig}
        onChange={handleFinanceChange}
      />
    </div>
  );
}
