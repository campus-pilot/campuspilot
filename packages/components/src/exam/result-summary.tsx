import { Badge } from '@campuspilot/ui/components/badge';

type SummaryPlan = {
  totalMarks: number;
  totalWorkingDays: number | null;
  modeConfig: Record<string, { maxMarks: number; percentage: number }>;
};
type SummaryResult = {
  marks: Record<string, number>;
  coScholastics: Record<string, string> | null;
  daysAttended: number | null;
  approved: boolean;
};

/** Displays raw component sums: component maxima already incorporate the configured weights. */
export function ResultSummary({
  plan,
  result,
  modeNames = {},
  areaNames = {},
  unsaved = false,
}: {
  plan: SummaryPlan;
  result: SummaryResult;
  modeNames?: Record<string, string>;
  areaNames?: Record<string, string>;
  unsaved?: boolean;
}) {
  const keys = Object.keys(plan.modeConfig);
  const valid =
    keys.length === Object.keys(result.marks).length &&
    keys.every(
      (key) =>
        Number.isFinite(result.marks[key]) &&
        result.marks[key]! >= 0 &&
        result.marks[key]! <= plan.modeConfig[key]!.maxMarks,
    );
  const total = keys.reduce((sum, key) => sum + (result.marks[key] ?? 0), 0);
  return (
    <section
      className="flex min-w-0 flex-col gap-4 rounded-xl border p-4"
      aria-label={unsaved ? 'Unsaved result preview' : 'Saved result preview'}
    >
      <Badge className="w-fit" variant="outline">
        {unsaved
          ? 'Unsaved preview'
          : result.approved
            ? '✓ Approved'
            : '◷ Awaiting review'}
      </Badge>
      {keys.map((key) => (
        <div key={key} className="flex flex-wrap justify-between gap-2">
          <span className="min-w-0 flex-1 break-words">
            {modeNames[key] ?? key}{' '}
            <span className="text-sm text-muted-foreground">
              ({plan.modeConfig[key]!.percentage}%)
            </span>
          </span>
          <strong className="max-w-full break-words">
            {result.marks[key] ?? '—'} / {plan.modeConfig[key]!.maxMarks}
          </strong>
        </div>
      ))}
      <p className="border-t pt-3 text-lg font-semibold">
        {valid
          ? `${total} / ${plan.totalMarks} · ${Number(((total / plan.totalMarks) * 100).toFixed(2))}%`
          : 'Incomplete result — check assessment components'}
      </p>
      {Object.entries(result.coScholastics ?? {}).map(([key, grade]) => (
        <div key={key} className="flex flex-wrap justify-between gap-2">
          <span className="min-w-0 flex-1 break-words">
            {areaNames[key] ?? key}
          </span>
          <strong className="max-w-full break-words">{grade}</strong>
        </div>
      ))}
      {result.daysAttended !== null && (
        <p>
          Attendance: {result.daysAttended}
          {plan.totalWorkingDays !== null
            ? ` / ${plan.totalWorkingDays} days`
            : ' days'}
          {plan.totalWorkingDays !== null && plan.totalWorkingDays > 0
            ? ` · ${Number(((result.daysAttended / plan.totalWorkingDays) * 100).toFixed(2))}%`
            : ''}
        </p>
      )}
    </section>
  );
}
