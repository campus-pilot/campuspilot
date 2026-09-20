'use client';

import { useSearchParams } from 'next/navigation';
import {
  AUTH_REDIRECT_QUERY_PARAM,
  buildSignInRedirectPath,
  sanitizeAuthRedirectPath,
} from '@campuspilot/auth/redirects';
import { AuthErrorPanel } from '@campuspilot/components/auth-error-panel';
import { AuthShell } from './auth-shell';

export function AuthErrorScreen() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get('error') ?? 'unknown_error';
  const redirectPath = sanitizeAuthRedirectPath(
    searchParams.get(AUTH_REDIRECT_QUERY_PARAM),
    '/school',
  );

  return (
    <AuthShell>
      <AuthErrorPanel
        errorCode={errorCode}
        retryHref={buildSignInRedirectPath(redirectPath, '/auth/login')}
      />
    </AuthShell>
  );
}
