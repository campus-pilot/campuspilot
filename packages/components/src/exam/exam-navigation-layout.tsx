import type { ReactNode } from 'react';

/** Shared detail-workspace proportions match admission/classroom pages. */
export function ExamNavigationLayout({
  heading,
  actions,
  navigation,
  mobileNavigation,
  children,
}: {
  heading: ReactNode;
  actions: ReactNode;
  navigation: ReactNode;
  mobileNavigation: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        {heading}
        {actions}
      </header>
      {mobileNavigation && <div className="md:hidden">{mobileNavigation}</div>}
      <div className="flex min-w-0 items-start gap-6">
        {navigation && (
          <aside
            className="hidden w-52 shrink-0 flex-col gap-1 md:flex"
            aria-label="Examination sections"
          >
            {navigation}
          </aside>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </section>
  );
}
