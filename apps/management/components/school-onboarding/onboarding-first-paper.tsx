'use client';

import Link from 'next/link';
import { useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@campuspilot/ui/components/button';
import { Label } from '@campuspilot/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { CircleCheck } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { AssistantAccess } from '../assistant/assistant-access';
import { questionPaperWorkspaceHref } from '../exam/exam-model';
import { useAllExams, type ExamSearchItem } from '../exam/use-all-exams';
import { schoolHref } from '../school-route';
import { storeSchoolSessionId } from '../session-selection';

type PaperChoice = { examSlug: string; classId: string; subjectSlug: string };

/** The classes, subjects and modes of an examination's papers, as the Question paper tab lists them. */
function usePaperClasses(schoolId: string, sessionId: string, examSlug: string) {
  return useQuery(orpc.school.listQuestionPapers.queryOptions({ input: { schoolId, sessionId, examSlug }, enabled: examSlug !== '' }));
}

/** A labelled select of the first-paper picker. */
function ChoiceSelect({ id, label, value, placeholder, options, onChange }: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The picker of the first paper: an examination, a class and a subject. The
 * paper opens on its start screen, where the person photographs a
 * handwritten paper, describes one to the assistant or adds a PDF. Each
 * subject the guide created has one mode, so the paper is the subject's
 * first mode; a subject changed since has its first mode opened.
 */
function FirstPaperForm({ schoolId, sessionId, exams }: { schoolId: string; sessionId: string; exams: ExamSearchItem[] }) {
  const router = useRouter();
  const form = useForm({
    defaultValues: { examSlug: exams[0]?.slug ?? '', classId: '', subjectSlug: '' } satisfies PaperChoice,
    onSubmit: ({ value }) => {
      const papers = queryClasses.data?.classes ?? [];
      const subject = papers.find((entry) => entry.classId === value.classId)?.subjects.find((entry) => entry.subjectSlug === value.subjectSlug);
      const mode = subject?.modes[0];
      if (!mode) return;
      storeSchoolSessionId(schoolId, sessionId);
      router.push(questionPaperWorkspaceHref({ schoolId, sessionId, examSlug: value.examSlug, classId: value.classId, subjectSlug: value.subjectSlug, modeSlug: mode.modeSlug }, { start: 'sources' }));
    },
  });
  // The chosen examination decides which classes and subjects are offered.
  const examSlug = useStore(form.store, (state) => state.values.examSlug);
  const queryClasses = usePaperClasses(schoolId, sessionId, examSlug);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="examSlug" listeners={{ onChange: () => form.setFieldValue('classId', '') }}>
        {(field) => (
          <ChoiceSelect id="first-paper-exam" label="Examination" value={field.state.value} placeholder="Choose an examination" options={exams.map((exam) => ({ value: exam.slug, label: exam.name }))} onChange={field.handleChange} />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.classId}>
        {(classId) => {
          const classes = queryClasses.data?.classes ?? [];
          const subjects = classes.find((entry) => entry.classId === classId)?.subjects ?? [];
          return (
            <div className="flex flex-col gap-4 sm:flex-row">
              <form.Field name="classId" listeners={{ onChange: () => form.setFieldValue('subjectSlug', '') }}>
                {(field) => (
                  <ChoiceSelect id="first-paper-class" label="Class" value={field.state.value} placeholder={queryClasses.isPending ? 'Loading…' : 'Choose a class'} options={classes.map((entry) => ({ value: entry.classId, label: entry.className }))} onChange={field.handleChange} />
                )}
              </form.Field>
              <form.Field name="subjectSlug">
                {(field) => (
                  <ChoiceSelect id="first-paper-subject" label="Subject" value={field.state.value} placeholder="Choose a subject" options={subjects.map((entry) => ({ value: entry.subjectSlug, label: entry.subjectName }))} onChange={field.handleChange} />
                )}
              </form.Field>
            </div>
          );
        }}
      </form.Subscribe>
      {queryClasses.isError ? <p role="alert" className="text-xs text-destructive">The classes could not be loaded. {queryClasses.error.message}</p> : null}
      <form.Subscribe selector={(state) => state.values.subjectSlug !== '' && state.values.classId !== ''}>
        {(chosen) => (
          <Button type="submit" disabled={!chosen}>
            Make this paper
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

/** The session's examinations, then the picker; keyed by session so it starts afresh with the first examination. */
function FirstPaperPicker({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const exams = useAllExams(schoolId, sessionId);
  if (exams.isPending) return <p className="text-sm text-muted-foreground">Loading your examinations…</p>;
  if (exams.isError) return <p role="alert" className="text-sm text-destructive">Your examinations could not be loaded. {exams.error.message}</p>;
  return <FirstPaperForm key={sessionId} schoolId={schoolId} sessionId={sessionId} exams={exams.data} />;
}

/**
 * The guide's last screen, once the school is set up: the first question
 * paper, for people who may use the assistant (papers are part of it), and a
 * way into the school for everyone.
 */
export function OnboardingFirstPaper({ schoolId }: { schoolId: string }) {
  const sessionQuery = useQuery(orpc.school.listSessions.queryOptions({ input: { schoolId, limit: 1, filters: { isActive: true } } }));
  const sessionId = sessionQuery.data?.items[0]?.id;
  return (
    <div className="flex w-full max-w-lg flex-col gap-5 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <CircleCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Your school is ready</h1>
          <p className="text-sm text-muted-foreground">Let&apos;s make your first question paper.</p>
        </div>
      </div>
      {sessionId ? (
        <AssistantAccess schoolId={schoolId}>
          <FirstPaperPicker schoolId={schoolId} sessionId={sessionId} />
        </AssistantAccess>
      ) : null}
      <Button asChild variant="ghost">
        <Link href={schoolHref(schoolId)}>Go to the dashboard instead</Link>
      </Button>
    </div>
  );
}
