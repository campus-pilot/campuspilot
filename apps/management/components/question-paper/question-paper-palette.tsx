'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ClipboardCheck, GraduationCap } from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { CommandGroup, CommandItem } from '@campuspilot/ui/components/command';
import { paletteItemClassName, ProviderStatus } from '@/components/command-palette-status';
import { CommandRow } from '@/components/command-row';
import { examStatusLabel, questionPaperClassHref } from '@/components/exam/exam-model';
import { useAllExams, type ExamSearchItem } from '@/components/exam/use-all-exams';
import { orpc } from '@/lib/orpc';
import { rankByQuery, type QuestionPaperPickerStep } from './question-paper-list-model';

/**
 * The command palette's way to a question paper: the "Question papers"
 * command opens this picker in place of the palette's results. It lists the
 * session's examinations, then the chosen one's classes (from
 * `listQuestionPapers`, so only classes the person may open), and choosing a
 * class goes to the examination's Question paper tab with that class open.
 * The palette's search box filters each step; the palette owns the step and
 * the search, this file only reads and lists.
 */

/** The row above the search box while picking: a back control and where the person is. */
export function QuestionPaperPickerHeader({ step, onBack }: { step: QuestionPaperPickerStep; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2.5 border-b px-2 py-2.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={step.step === 'exam' ? 'Back to search' : 'Back to examinations'}
        onClick={onBack}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{step.step === 'exam' ? 'Question papers' : step.exam.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {step.step === 'exam' ? 'Choose an examination' : 'Choose a class'}
        </p>
      </div>
    </div>
  );
}

export function QuestionPaperPickerResults({
  schoolId,
  sessionId,
  step,
  query,
  onPickExam,
  navigate,
}: {
  schoolId: string;
  sessionId: string;
  step: QuestionPaperPickerStep;
  query: string;
  onPickExam: (exam: { slug: string; name: string }) => void;
  navigate: (href: string) => Promise<void>;
}) {
  return step.step === 'exam' ? (
    <ExamStep schoolId={schoolId} sessionId={sessionId} query={query} onPickExam={onPickExam} />
  ) : (
    <ClassStep scope={{ schoolId, sessionId, examSlug: step.exam.slug }} query={query} navigate={navigate} />
  );
}

/** The session's examinations, completed ones included (their papers can still be viewed). */
function ExamStep({
  schoolId,
  sessionId,
  query,
  onPickExam,
}: {
  schoolId: string;
  sessionId: string;
  query: string;
  onPickExam: (exam: { slug: string; name: string }) => void;
}) {
  const examsQuery = useAllExams(schoolId, sessionId, { staleTime: Number.POSITIVE_INFINITY });
  if (examsQuery.data === undefined) {
    return examsQuery.isError ? (
      <ProviderStatus heading="Examinations" label="Examinations could not be loaded" retry={() => void examsQuery.refetch()} />
    ) : (
      <ProviderStatus heading="Examinations" label="Loading examinations…" />
    );
  }
  const exams = rankByQuery<ExamSearchItem>(examsQuery.data, query, (exam) => [exam.name, exam.slug]);
  if (!exams.length) return null;
  return (
    <CommandGroup heading="Examinations">
      {exams.map((exam) => (
        <CommandItem
          className={paletteItemClassName}
          key={exam.slug}
          value={`question-paper-exam:${exam.slug}`}
          onSelect={() => onPickExam({ slug: exam.slug, name: exam.name })}
        >
          <CommandRow icon={ClipboardCheck} label={exam.name} description={examStatusLabel(exam.status)} />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/** The classes of the chosen examination the person may open, exactly as the server lists them. */
function ClassStep({
  scope,
  query,
  navigate,
}: {
  scope: { schoolId: string; sessionId: string; examSlug: string };
  query: string;
  navigate: (href: string) => Promise<void>;
}) {
  const classesQuery = useQuery(orpc.school.listQuestionPapers.queryOptions({ input: scope }));
  if (classesQuery.data === undefined) {
    return classesQuery.isError ? (
      <ProviderStatus heading="Classes" label="Classes could not be loaded" retry={() => void classesQuery.refetch()} />
    ) : (
      <ProviderStatus heading="Classes" label="Loading classes…" />
    );
  }
  const classes = rankByQuery(classesQuery.data.classes, query, (item) => [item.className]);
  if (!classes.length) return null;
  return (
    <CommandGroup heading="Classes">
      {classes.map((item) => (
        <CommandItem
          className={paletteItemClassName}
          key={item.classId}
          value={`question-paper-class:${item.classId}`}
          onSelect={() => void navigate(questionPaperClassHref({ ...scope, classId: item.classId }))}
        >
          <CommandRow icon={GraduationCap} label={item.className} description="Open its question papers" />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
