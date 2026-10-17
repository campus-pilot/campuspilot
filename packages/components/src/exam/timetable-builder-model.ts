export type TimetableClass = {
  id: string;
  label: string;
  subjects: Record<
    string,
    {
      name: string;
      examModes: Record<string, { name: string; percentage: number }>;
    }
  >;
};
export type TimetablePair = { subjectSlug: string; modeSlug: string };
export type TimetableRow = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  cells: Record<string, TimetablePair | TimetablePair[] | null>;
};

export type TimetableConfig = { columns: string[]; rows: TimetableRow[] };
export const timetablePairs = (
  cell: TimetableRow['cells'][string] | undefined,
): TimetablePair[] => (cell == null ? [] : Array.isArray(cell) ? cell : [cell]);
export const encodeTimetablePair = (pair: TimetablePair) =>
  JSON.stringify([pair.subjectSlug, pair.modeSlug]);
export function decodeTimetablePair(value: string): TimetablePair | null {
  if (!value) return null;
  const [subjectSlug, modeSlug] = JSON.parse(value) as [string, string];
  return { subjectSlug, modeSlug };
}
/** Copying/reordering changes only the requested fact; assignments and stable
 * row IDs survive, including data belonging to a hidden mobile class column.
 */
export function copyTimetableTiming(
  rows: TimetableRow[],
  sourceId: string,
  targetId: string,
) {
  const source = rows.find((row) => row.id === sourceId);
  return source
    ? rows.map((row) =>
        row.id === targetId
          ? { ...row, startTime: source.startTime, endTime: source.endTime }
          : row,
      )
    : rows;
}
export function removeTimetableColumn(
  config: TimetableConfig,
  classId: string,
): TimetableConfig {
  return {
    columns: config.columns.filter((id) => id !== classId),
    rows: config.rows.map((row) => ({
      ...row,
      cells: Object.fromEntries(
        Object.entries(row.cells).filter(([id]) => id !== classId),
      ),
    })),
  };
}
/** Date-only defaults are calculated in the local calendar, never by slicing a
 * UTC timestamp. A new row follows the last valid date, including month/year rollover.
 */
export function nextTimetableDate(rows: TimetableRow[], today = new Date()) {
  const last = [...rows]
    .reverse()
    .find((row) => parseTimetableDate(row.date) !== null);
  const date = last ? new Date(`${last.date}T12:00:00`) : new Date(today);
  if (last) date.setDate(date.getDate() + 1);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Reject normalized dates such as February 30 rather than showing a misleading weekday. */
export function parseTimetableDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const [year, month, day] = value.split('-').map(Number);
  return date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
    ? date
    : null;
}
