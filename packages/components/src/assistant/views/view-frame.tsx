import type { ReactNode } from 'react';

/** A view's optional heading and body, aligned with the prose around it. */
export function AssistantViewFrame({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 px-1" aria-label={title}>
      {title ? <h3 className="text-sm font-medium text-foreground">{title}</h3> : null}
      {children}
    </section>
  );
}
