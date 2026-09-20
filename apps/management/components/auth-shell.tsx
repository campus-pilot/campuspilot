import type { ReactNode } from 'react';
import { ThemeToggle } from '@campuspilot/components/theme-toggle';
import { LoginCuboidScene } from './login-cuboid-scene';
import { ArrowRight } from 'lucide-react';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[1.06fr_0.94fr]">
      <section className="relative isolate hidden min-h-svh overflow-hidden bg-muted text-foreground lg:block">
        <LoginCuboidScene />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-12 xl:p-16">
          <h1 className="bg-background  p-3 max-w-lg text-balance text-4xl font-semibold leading-[0.96] tracking-tighter xl:text-5xl">
            Welcome back to the work that moves your school forward.{' '}
          </h1>
        </div>
      </section>
      <section className="relative flex min-h-168 items-center justify-center bg-background px-6 py-24 text-foreground sm:px-10 lg:min-h-svh lg:px-14 xl:px-20">
        <div className="absolute right-5 top-5 sm:right-7 sm:top-7">
          <ThemeToggle />
        </div>
        <div className="login-panel-enter w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}
