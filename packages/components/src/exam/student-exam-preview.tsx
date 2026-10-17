import { DataTable } from '../data-grid';

type Subject = {
  plan: {
    subjectSlug: string;
    totalMarks: number;
    modeConfig: Record<string, { maxMarks: number; percentage: number }>;
  };
  result: {
    marks: Record<string, number>;
    approved: boolean;
    daysAttended: number | null;
    coScholastics: Record<string, string> | null;
  } | null;
};
export type StudentExamPreviewData = {
  subjects: Subject[];
  context: {
    classes: Array<{
      subjects: Record<
        string,
        { name: string; examModes: Record<string, { name: string }> }
      >;
    }>;
    coScholasticAreas: Record<string, { name: string }>;
    attendanceTracking: { enabled: boolean };
  };
  assessment: {
    daysAttended: number | null;
    coScholastics: Record<string, string> | null;
    approved: boolean;
  } | null;
  totalWorkingDays: number | null;
};
/** Component maxima already include weights. Totals are raw sums, never weighted
 * again. Missing results remain visibly missing rather than becoming zeroes.
 */
export function StudentExamPreview({
  data,
  unsaved = false,
}: {
  data: StudentExamPreviewData;
  unsaved?: boolean;
}) {
  const names = data.context.classes[0]?.subjects ?? {};
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-label={
        unsaved ? 'Unsaved examination preview' : 'Saved examination results'
      }
    >
      {unsaved && (
        <p className="text-sm text-muted-foreground">Unsaved preview</p>
      )}
      <DataTable
        ariaLabel="Student subject results"
        data={data.subjects}
        columns={[
          {
            id: 'subject',
            header: 'Subject',
            cell: ({ row }) =>
              names[row.original.plan.subjectSlug]?.name ??
              row.original.plan.subjectSlug,
          },
          {
            id: 'modes',
            header: 'Marks',
            cell: ({ row }) => (
              <div className="flex flex-col gap-1">
                {Object.entries(row.original.plan.modeConfig).map(
                  ([slug, mode]) => (
                    <span key={slug}>
                      {names[row.original.plan.subjectSlug]?.examModes[slug]
                        ?.name ?? slug}
                      : {row.original.result?.marks[slug] ?? '—'} /{' '}
                      {mode.maxMarks}
                    </span>
                  ),
                )}
              </div>
            ),
          },
          {
            id: 'total',
            header: 'Total',
            cell: ({ row }) =>
              row.original.result
                ? `${Object.values(row.original.result.marks).reduce((sum, score) => sum + score, 0)} / ${row.original.plan.totalMarks}`
                : '—',
          },
          {
            id: 'status',
            header: 'Review',
            cell: ({ row }) =>
              unsaved
                ? 'Unsaved'
                : row.original.result?.approved
                  ? 'Approved'
                  : row.original.result
                    ? 'Awaiting review'
                    : 'Not entered',
          },
        ]}
      />
      <SharedAssessmentPreview data={data} unsaved={unsaved} />
      <LegacyAssessments subjects={data.subjects} names={names} />
    </section>
  );
}
function SharedAssessmentPreview({
  data,
  unsaved,
}: {
  data: StudentExamPreviewData;
  unsaved: boolean;
}) {
  const grades = {
    ...Object.fromEntries(
      Object.keys(data.context.coScholasticAreas).map((slug) => [slug, '—']),
    ),
    ...data.assessment?.coScholastics,
  };
  if (
    !data.context.attendanceTracking.enabled &&
    data.assessment?.daysAttended == null &&
    !Object.keys(grades).length
  )
    return null;
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border p-3"
      aria-label="Attendance and activities"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="font-medium">Attendance &amp; activities</h2>
        <span className="text-sm text-muted-foreground">
          {unsaved
            ? 'Unsaved'
            : data.assessment?.approved
              ? 'Approved'
              : data.assessment
                ? 'Awaiting review'
                : 'Not entered'}
        </span>
      </div>
      {(data.context.attendanceTracking.enabled ||
        data.assessment?.daysAttended != null) && (
        <p className="text-sm">
          Days attended: {data.assessment?.daysAttended ?? '—'}
          {data.totalWorkingDays !== null ? ` / ${data.totalWorkingDays}` : ''}
        </p>
      )}
      {Object.entries(grades).map(([slug, grade]) => (
        <div key={slug} className="flex justify-between gap-3 text-sm">
          <span>
            {data.context.coScholasticAreas[slug]?.name ??
              `${slug} (historical)`}
          </span>
          <strong>{grade}</strong>
        </div>
      ))}
    </section>
  );
}
/** Historical per-subject metadata stays visible without claiming that it is
 * the shared exam-wide assessment. New saves never overwrite these values.
 */
function LegacyAssessments({
  subjects,
  names,
}: {
  subjects: Subject[];
  names: Record<string, { name: string }>;
}) {
  const legacy = subjects.filter(
    ({ result }) =>
      result &&
      (result.daysAttended !== null ||
        Object.keys(result.coScholastics ?? {}).length),
  );
  if (!legacy.length) return null;
  return (
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer py-2">
        Historical subject assessments
      </summary>
      <p>
        These values were saved per subject. They are preserved separately from
        the attendance and activities above.
      </p>
      {legacy.map(({ plan, result }) => (
        <p key={plan.subjectSlug} className="py-2">
          {names[plan.subjectSlug]?.name ?? plan.subjectSlug}:{' '}
          {result!.daysAttended !== null
            ? `${result!.daysAttended} days attended. `
            : ''}
          {Object.entries(result!.coScholastics ?? {})
            .map(([slug, value]) => `${slug}: ${value}`)
            .join(', ')}
        </p>
      ))}
    </details>
  );
}
