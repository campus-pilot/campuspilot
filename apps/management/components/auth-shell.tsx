import type { ReactNode } from 'react';
import { ThemeToggle } from '@campuspilot/components/theme-toggle';
import { BadgeCheck, BookOpenText, ShieldCheck, Sparkles } from 'lucide-react';

const highlights = [
  { icon: BookOpenText, label: 'One calm workspace' },
  { icon: BadgeCheck, label: 'Role-aware access' },
  { icon: ShieldCheck, label: 'Protected school data' },
];

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-xl bg-primary-foreground text-primary shadow-sm">
        <BookOpenText className="size-5" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold tracking-tight">CampusPilot</span>
    </div>
  );
}

function AuthStory() {
  return (
    <section className="relative isolate flex min-h-[18rem] overflow-hidden bg-primary px-6 py-7 text-primary-foreground sm:px-10 sm:py-10 lg:min-h-svh lg:px-14 lg:py-12 xl:px-20">
      <div className="absolute -right-24 -top-28 size-72 rounded-full border border-primary-foreground/15" />
      <div className="absolute -right-8 -top-12 size-48 rounded-full bg-primary-foreground/7" />
      <div className="absolute -bottom-32 -left-24 size-80 rounded-full border border-primary-foreground/15" />
      <div className="relative flex w-full flex-col justify-between gap-12">
        <BrandMark />

        <div className="max-w-2xl lg:max-w-xl">
          <div className="mb-5 hidden w-fit items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1.5 text-xs font-medium backdrop-blur-sm sm:flex">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Built for the people who keep schools moving
          </div>
          <h1 className="text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-5xl lg:text-6xl xl:text-7xl">
            Welcome back to the work that moves your school forward.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-6 text-primary-foreground/75 sm:text-base sm:leading-7">
            Securely return to admissions, classrooms, examinations, billing,
            documents, and school services—all in one place.
          </p>
        </div>

        <div className="hidden flex-wrap gap-2 sm:flex">
          {highlights.map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1.5 text-xs font-medium text-primary-foreground/85 backdrop-blur-sm"
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(30rem,0.95fr)]">
      <AuthStory />
      <section className="relative flex min-h-[36rem] items-center justify-center px-6 py-14 sm:px-10 lg:min-h-svh lg:px-14 xl:px-20">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}
