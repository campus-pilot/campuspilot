/**
 * Report-card mode columns. Subjects in one report may use different
 * assessment modes (for example Mathematics: Written and Oral, English:
 * Written only), so a marks table cannot take its columns from any single
 * subject. The render data therefore carries an explicit column list and, per
 * subject, one cell per column, so templates only iterate and never compute
 * the layout in Handlebars.
 */

type ReportModeSubject = {
  marks: Record<string, number>;
  modeConfig: Record<string, { name: string; maxMarks: number }>;
};

/** One marks-table column: an assessment mode used by at least one subject. */
export type ReportModeColumn = {
  slug: string;
  /** Display name from the first subject (in report order) that uses the mode. */
  name: string;
  /**
   * The shared maximum when every subject with this mode uses the same
   * maximum; `null` when subjects differ, because no single value is true.
   */
  maxMarks: number | null;
};

/** One subject's cell under a column. */
export type ReportModeCell = {
  slug: string;
  /** False when the subject has no such mode; templates render a blank cell. */
  applicable: boolean;
  /** The recorded mark, or `null` when the mode does not apply. Zero stays zero. */
  mark: number | null;
  /** This subject's maximum for the mode, or `null` when it does not apply. */
  maxMarks: number | null;
};

/**
 * The union of every subject's modes. Columns are ordered by display name,
 * then slug: mode keys come from JSONB objects whose key order PostgreSQL does
 * not preserve, so neither configuration order nor subject order is a stable
 * source for column order.
 */
export function reportModeColumns(
  subjects: readonly ReportModeSubject[],
): ReportModeColumn[] {
  const columns = new Map<string, { name: string; maxima: Set<number> }>();
  for (const subject of subjects) {
    for (const [slug, mode] of Object.entries(subject.modeConfig)) {
      const column = columns.get(slug);
      if (column) column.maxima.add(mode.maxMarks);
      else columns.set(slug, { name: mode.name, maxima: new Set([mode.maxMarks]) });
    }
  }
  return [...columns]
    .map(([slug, { name, maxima }]) => ({
      slug,
      name,
      maxMarks: maxima.size === 1 ? [...maxima][0]! : null,
    }))
    .sort((a, b) =>
      a.name === b.name
        ? a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0
        : a.name < b.name ? -1 : 1,
    );
}

/**
 * Adds `modeColumns` to a report context and `modeCells` (aligned with
 * `modeColumns`) to each of its subjects. Existing `marks` and `modeConfig`
 * fields are kept for templates written against them.
 */
export function withReportModeLayout<
  Context extends { subjects: readonly ReportModeSubject[] },
>(context: Context) {
  const modeColumns = reportModeColumns(context.subjects);
  return {
    ...context,
    modeColumns,
    subjects: context.subjects.map((subject: Context["subjects"][number]) => ({
      ...subject,
      modeCells: modeColumns.map((column): ReportModeCell => {
        const mode = Object.hasOwn(subject.modeConfig, column.slug)
          ? subject.modeConfig[column.slug]!
          : null;
        return {
          slug: column.slug,
          applicable: mode !== null,
          mark:
            mode !== null && Object.hasOwn(subject.marks, column.slug)
              ? subject.marks[column.slug]!
              : null,
          maxMarks: mode?.maxMarks ?? null,
        };
      }),
    })),
  };
}
