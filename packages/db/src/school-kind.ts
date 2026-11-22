/**
 * What kind of school a `school` row is (docs/personal-space.md). Its own fact,
 * never inferred from the name, the owner, the tier or the absence of a
 * session. Free of imports so the browser apps can read it too.
 * - `school`: a real school with staff, sessions, classes and students.
 * - `personal`: one person's personal space, which holds only standalone
 *   question papers. The API refuses every procedure that does not say it
 *   serves personal schools (`schoolKinds` in the procedure metadata).
 */
export const SCHOOL_KINDS = ['school', 'personal'] as const;
export type SchoolKind = (typeof SCHOOL_KINDS)[number];

/** The kinds a procedure serves when it does not say: real schools only, so a new procedure fails closed for personal spaces. */
export const DEFAULT_SCHOOL_KINDS: readonly SchoolKind[] = ['school'];
