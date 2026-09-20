import Link from 'next/link';
import type { Metadata } from 'next';
import { ThemeToggle } from '@campuspilot/components/theme-toggle';
import { Button } from '@campuspilot/ui/components/button';
import { ArrowRight, BookOpenText, LogOut } from 'lucide-react';

export const metadata: Metadata = {
  title: 'School',
};

export default function SchoolPage() {
  return (
    <main className="min-h-svh bg-background">
      <header className="flex items-center justify-between border-b px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <BookOpenText className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold">CampusPilot</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" asChild>
            <Link href="/auth/logout">
              <LogOut aria-hidden="true" />
              Log out
            </Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto flex max-w-5xl flex-col gap-7 px-5 py-16 sm:px-8 sm:py-24">
        <span className="w-fit rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
          Authenticated workspace
        </span>
        <div className="max-w-3xl">
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">
            Your school workspace starts here.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            Authentication and route protection are ready. The next management
            workflows can now be built behind this boundary.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          Ready for the next module
          <ArrowRight className="size-4" aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}
