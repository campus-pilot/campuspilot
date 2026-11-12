import { TriangleAlert } from 'lucide-react';
import { formatMarks } from './question-paper-model';

export type MarksWarningView = { code: string; message: string };

/**
 * The paper's marks against the examination plan, its warnings, and a note when
 * figures are still placeholders. Marks that do not add up are a warning only
 * (D23): the paper can still be previewed and downloaded.
 */
export function MarksSummary({ totalMarks, planMaxMarks, warnings }: {
  totalMarks: number | null;
  planMaxMarks: number | null;
  warnings: readonly MarksWarningView[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        <span className="font-medium">Total marks: </span>
        {totalMarks === null ? 'not available' : formatMarks(totalMarks)}
        {planMaxMarks === null ? null : <span className="text-muted-foreground"> of {planMaxMarks} in the plan</span>}
      </p>
      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Warnings">
          {warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`} className="flex items-start gap-2 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Whether any warning says a figure is still a placeholder (the user adds the real image in chat). */
export function hasFigurePlaceholders(warnings: readonly MarksWarningView[]) {
  return warnings.some((warning) => warning.code === 'figure_placeholder_unresolved');
}
