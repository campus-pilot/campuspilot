/** The first error of a field, as TanStack Form keeps it (a string or a Standard Schema issue). */
export function firstError(errors: unknown[]): string | null {
  const error = errors[0];
  if (!error) return null;
  if (typeof error === "string") return error;
  return (error as { message?: string }).message ?? null;
}

export function FieldError({ id, message }: { id: string; message: string | null }) {
  return message ? (
    <p id={id} className="pg-book-form-error" role="alert">
      {message}
    </p>
  ) : null;
}

export function FieldLabel({ htmlFor, children, optional = false }: { htmlFor?: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <label className="pg-book-form-label" htmlFor={htmlFor}>
      {children}
      {optional ? <span>Optional</span> : null}
    </label>
  );
}
