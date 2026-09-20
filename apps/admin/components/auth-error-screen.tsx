'use client';

import { useSearchParams } from 'next/navigation';
import {
  AUTH_REDIRECT_QUERY_PARAM,
  buildSignInRedirectPath,
  sanitizeAuthRedirectPath,
} from '@campuspilot/auth/redirects';
import { AuthErrorPanel } from '@campuspilot/components/auth-error-panel';
import { ThemeToggle } from '@campuspilot/components/theme-toggle';

export function AuthErrorScreen() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get('error') ?? 'unknown_error';
  const redirectPath = sanitizeAuthRedirectPath(
    searchParams.get(AUTH_REDIRECT_QUERY_PARAM),
  );

  return (
    <main className="relative grid min-h-screen place-items-center bg-muted/40 p-6">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <section className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <AuthErrorPanel
          errorCode={errorCode}
          retryHref={buildSignInRedirectPath(redirectPath)}
        />
      </section>
    </main>
  );
}
