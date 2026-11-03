import type { ReactNode } from "react";

/** Shared detail-workspace proportions match admission/classroom pages. */
export function WorkspaceNavigationLayout({
  heading,
  actions,
  navigation,
  children,
  navigationLabel = "Workspace sections",
}: {
  heading: ReactNode;
  actions: ReactNode;
  navigation: ReactNode;
  children: ReactNode;
  navigationLabel?: string;
}) {
  return (
    <section className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {heading}
        {actions}
      </header>
      {navigation ? <nav aria-label={navigationLabel}>{navigation}</nav> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}
