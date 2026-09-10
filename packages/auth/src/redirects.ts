export const AUTH_REDIRECT_QUERY_PARAM = 'redirect';
export const DEFAULT_POST_SIGN_IN_PATH = '/dashboard';

const UNSAFE_PATH = /[\\\u0000-\u001f\u007f]|%(?:2f|5c)/i;

/**
 * Accept only local application paths. This prevents a sign-in URL from being
 * used as an open redirect to another origin.
 */
export function sanitizeAuthRedirectPath(
  value: string | null | undefined,
  fallback = DEFAULT_POST_SIGN_IN_PATH,
) {
  if (!value?.startsWith('/') || value.startsWith('//') || UNSAFE_PATH.test(value)) {
    return fallback;
  }

  return value;
}

export function buildSignInRedirectPath(
  returnTo: string,
  signInPath = '/sign-in',
) {
  const search = new URLSearchParams({
    [AUTH_REDIRECT_QUERY_PARAM]: sanitizeAuthRedirectPath(returnTo),
  });

  return `${signInPath}?${search.toString()}`;
}

export function buildAuthCallbackURL(appOrigin: string, redirectPath: string) {
  const origin = new URL(appOrigin).origin;
  return new URL(sanitizeAuthRedirectPath(redirectPath), origin).toString();
}
