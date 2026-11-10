import { Card, CardContent, CardHeader, CardTitle } from '@campuspilot/ui/components/card';

/** A published timetable as the Cadet Portal reads it: dates `YYYY-MM-DD`, times local `HH:mm`. */
export type PublishedTimetableView = {
  columns: { classId: string; label: string }[];
  rows: {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    entries: { classId: string; subjects: { subjectName: string; modeName: string }[] }[];
  }[];
};

/**
 * A read-only examination timetable, one card per class listing only the
 * slots that class sits, in the order given. A class with nothing scheduled
 * says so rather than disappearing. `formatDate` turns a `YYYY-MM-DD` date
 * into the viewer's wording, so this stays free of app formatting.
 */
export function PublishedTimetable({ timetable, formatDate }: { timetable: PublishedTimetableView; formatDate: (date: string) => string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {timetable.columns.map((column) => (
        <ClassSchedule key={column.classId} column={column} timetable={timetable} formatDate={formatDate} />
      ))}
    </div>
  );
}

function ClassSchedule({
  column,
  timetable,
  formatDate,
}: {
  column: PublishedTimetableView['columns'][number];
  timetable: PublishedTimetableView;
  formatDate: (date: string) => string;
}) {
  const slots = timetable.rows.flatMap((row) => {
    const subjects = row.entries.find((entry) => entry.classId === column.classId)?.subjects ?? [];
    return subjects.length ? [{ row, subjects }] : [];
  });
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">{column.label}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No examinations scheduled for this class.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {slots.map(({ row, subjects }) => (
              <li key={row.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                <span className="text-sm font-medium">{formatDate(row.date)}</span>
                <span className="text-xs text-muted-foreground">
                  {row.startTime}–{row.endTime}
                </span>
                {subjects.map((subject) => (
                  <span key={`${subject.subjectName}:${subject.modeName}`} className="text-sm">
                    {subject.subjectName} · {subject.modeName}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
