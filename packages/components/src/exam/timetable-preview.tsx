import { DataTable } from '../data-grid';
import {
  timetablePairs,
  type TimetableConfig,
} from './timetable-builder-model';
import type { TimetableClass } from './timetable-builder-model';

/** Shows every configured class, including classes with no scheduled assessments. */
export function TimetablePreview({
  config,
  classes,
}: {
  config: TimetableConfig;
  classes: TimetableClass[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {classes.map((schoolClass) => (
        <section key={schoolClass.id} className="flex min-w-0 flex-col gap-2">
          <h2 className="text-sm font-medium">{schoolClass.label}</h2>
          <ClassTimetable config={config} schoolClass={schoolClass} />
        </section>
      ))}
    </div>
  );
}

function ClassTimetable({
  config,
  schoolClass,
}: {
  config: TimetableConfig;
  schoolClass: TimetableClass;
}) {
  const rows = config.rows
    .filter((row) => timetablePairs(row.cells[schoolClass.id]).length > 0)
    .sort((a, b) =>
      `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`),
    );
  return (
    <DataTable
      ariaLabel={`${schoolClass.label} examination timetable`}
      emptyMessage="No examinations scheduled for this class."
      data={rows}
      columns={[
        { id: 'date', header: 'Date', cell: ({ row }) => row.original.date },
        {
          id: 'time',
          header: 'Time',
          cell: ({ row }) =>
            `${row.original.startTime}–${row.original.endTime}`,
        },
        {
          id: 'assessment',
          header: 'Assessment',
          cell: ({ row }) => (
            <div className="flex flex-col gap-1 whitespace-normal">
              {timetablePairs(row.original.cells[schoolClass.id]).map(
                (pair) => (
                  <span key={`${pair.subjectSlug}:${pair.modeSlug}`}>
                    {schoolClass.subjects[pair.subjectSlug]?.name ??
                      pair.subjectSlug}{' '}
                    ·{' '}
                    {schoolClass.subjects[pair.subjectSlug]?.examModes[
                      pair.modeSlug
                    ]?.name ?? pair.modeSlug}
                  </span>
                ),
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
