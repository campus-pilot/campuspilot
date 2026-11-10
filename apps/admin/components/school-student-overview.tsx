'use client';

import {
  ClassEnrolmentCard,
  SchoolStatsBoundary,
  StudentMetricTiles,
} from './school-stats';

/**
 * Students page for platform admins. Admins may not read student records,
 * so this shows aggregate admission and enrolment counts only.
 */
export function SchoolStudentOverview({ schoolId }: { schoolId: string }) {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
        <p className="text-sm text-muted-foreground">
          Aggregate student counts. Individual student records stay private to the school.
        </p>
      </div>
      <SchoolStatsBoundary schoolId={schoolId} skeletonTiles={4}>
        {(stats) => (
          <>
            <StudentMetricTiles stats={stats} />
            <ClassEnrolmentCard stats={stats} />
          </>
        )}
      </SchoolStatsBoundary>
    </section>
  );
}
