'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  Calendar,
  CheckCircle2,
  Clock,
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
 * Renders the 5 core sections in order: Examinations, Co-scholastics, Grading Scale,
 * Attendance, and Finance, wrapped in clean bordered divs.
 */
export function SessionDetailsView({
  session,
  isSaving = false,
  onSave,
  onDirtyChange,
}: SessionDetailsViewProps) {
  const [draftSessionConfig, setDraftSessionConfig] = useState<SessionConfig | null>(
    () => session.sessionConfig,
  );
  const [draftFinanceConfig, setDraftFinanceConfig] =
    useState<FinanceSchemaConfig | null>(() => session.financeConfig);

  // Compute dirty status by serializing the drafts against baseline props
  const isDirty = useMemo(() => {
    const originalSessionNormalized = normalizeSessionConfig(session.sessionConfig);
    const draftSessionNormalized = normalizeSessionConfig(draftSessionConfig);
    const sessionConfigChanged =
      JSON.stringify(originalSessionNormalized) !==
      JSON.stringify(draftSessionNormalized);

    const financeConfigChanged =
      JSON.stringify(session.financeConfig) !==
      JSON.stringify(draftFinanceConfig);

    const dirty = sessionConfigChanged || financeConfigChanged;
    onDirtyChange?.(dirty);
    return dirty;
  }, [
    session.sessionConfig,
    session.financeConfig,
    draftSessionConfig,
    draftFinanceConfig,
    onDirtyChange,
  ]);

  function handleReset() {
    setDraftSessionConfig(session.sessionConfig);
    setDraftFinanceConfig(session.financeConfig);
  }

  function handleExamConfigChange(
    nextExamConfig: Record<string, ExamDefinition>,
  ) {
    setDraftSessionConfig((prev) => ({
      examConfig: nextExamConfig,
      coScholasticAreas: prev?.coScholasticAreas ?? {},
      gradingScale: prev?.gradingScale ?? {},
      attendanceTracking: prev?.attendanceTracking ?? { enabled: false },
    }));
  }

  function handleCoScholasticChange(
    nextAreas: Record<string, CoScholasticArea>,
  ) {
    setDraftSessionConfig((prev) => ({
      examConfig: prev?.examConfig ?? {},
      coScholasticAreas: nextAreas,
      gradingScale: prev?.gradingScale ?? {},
      attendanceTracking: prev?.attendanceTracking ?? { enabled: false },
    }));
  }

  function handleGradingScaleChange(
    nextScale: Record<string, GradeDefinition>,
  ) {
    setDraftSessionConfig((prev) => ({
      examConfig: prev?.examConfig ?? {},
      coScholasticAreas: prev?.coScholasticAreas ?? {},
      gradingScale: nextScale,
      attendanceTracking: prev?.attendanceTracking ?? { enabled: false },
    }));
  }

  function handleAttendanceChange(enabled: boolean) {
    setDraftSessionConfig((prev) => ({
      examConfig: prev?.examConfig ?? {},
      coScholasticAreas: prev?.coScholasticAreas ?? {},
      gradingScale: prev?.gradingScale ?? {},
      attendanceTracking: { enabled },
    }));
  }

  function handleFinanceChange(nextFinance: FinanceSchemaConfig | null) {
    setDraftFinanceConfig(nextFinance);
  }

  async function handleSubmitSave() {
    if (!onSave) return;
    await onSave({
      sessionConfig: draftSessionConfig,
      financeConfig: draftFinanceConfig,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Session Banner / Action Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Calendar className="size-5" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                Academic Year {session.sessionStartYear}&ndash;{session.sessionEndYear}
              </h1>
              {session.isActive ? (
                <Badge variant="default" className="gap-1 bg-emerald-600 text-[10px] hover:bg-emerald-600/90 dark:bg-emerald-500">
                  <CheckCircle2 className="size-3" />
                  Active session
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Clock className="size-3" />
                  Inactive
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Manage evaluations, ECA criteria, grade scales, and financial schemas for this academic term.
            </p>
          </div>
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
