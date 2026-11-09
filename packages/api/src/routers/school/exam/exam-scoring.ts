/**
 * The one scoring rule shared by report cards (document contexts) and the
 * Cadet Portal, so a student's percentage and grade can never differ between
 * the PDF the school prints and what the portal shows.
 */

/** Percentage to one decimal place; 0 when nothing could be scored. */
export function scorePercent(score: number, maximum: number) {
  return maximum > 0 ? Math.round((score / maximum) * 1000) / 10 : 0;
}

/**
 * The label of the highest grade whose threshold the percentage reaches, or
 * null when the scale is empty or nothing matches. Callers decide how to show
 * "no grade"; nothing is invented here.
 */
export function gradeLabel(
  percentage: number,
  scale: Record<string, { label: string; minScore: number }>,
): string | null {
  return (
    Object.values(scale)
      .sort((a, b) => b.minScore - a.minScore)
      .find((grade) => percentage >= grade.minScore)?.label ?? null
  );
}
