import type { DatabaseExecutor } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { cadetAccount, cadetUser } from '@campuspilot/db/schema/cadet';
import { schoolTable } from '@campuspilot/db/schema/school';
import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
  getIP,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  CADET_ADMISSION_FAILURE_WINDOW_SECONDS,
  CADET_ADMISSION_LOCK_SECONDS,
  CADET_ADMISSION_MAX_FAILURES,
  CADET_ADMISSION_SIGN_IN_PATH,
  CADET_IP_FAILURE_WINDOW_SECONDS,
  CADET_IP_LOCK_SECONDS,
  CADET_IP_MAX_FAILURES,
} from './cadet-policy';
import type { FailureLimit, SignInLimiter } from './cadet-sign-in-limits';

const ADMISSION_LIMIT: FailureLimit = {
  maxFailures: CADET_ADMISSION_MAX_FAILURES,
  windowSeconds: CADET_ADMISSION_FAILURE_WINDOW_SECONDS,
  lockSeconds: CADET_ADMISSION_LOCK_SECONDS,
};

const IP_LIMIT: FailureLimit = {
  maxFailures: CADET_IP_MAX_FAILURES,
  windowSeconds: CADET_IP_FAILURE_WINDOW_SECONDS,
  lockSeconds: CADET_IP_LOCK_SECONDS,
};

/** One message for every credential failure, so none reveals which part was wrong. */
const INVALID_CREDENTIALS = {
  code: 'INVALID_CADET_CREDENTIALS',
  message: 'The school code, admission number or password is incorrect.',
};

function tooManyAttempts(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return new APIError('TOO_MANY_REQUESTS', {
    code: 'CADET_SIGN_IN_LOCKED',
    message: `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
  });
}

export const cadetAdmissionSignInBodySchema = z.object({
  /** The school's slug, shown to students as their "School code". */
  schoolSlug: z.string().trim().toLowerCase().min(1).max(100),
  admissionNo: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(128),
  /**
   * The authorization server's signed query, forwarded by the sign-in page
   * when an AI app's authorization sent the student there. The OAuth
   * provider plugin's hooks read it to resume that authorization.
   */
  oauth_query: z.string().optional(),
});

/**
 * Finds the admission a student typed and its cadet login. The admission
 * number is resolved against the live `admission.admission_no` right now and
 * used for nothing else, so a renamed number works immediately and the old
 * one stops working. Registered and unregistered admissions both match:
 * registration and portal access are separate facts.
 */
async function findCadetLogin(
  db: DatabaseExecutor,
  schoolSlug: string,
  admissionNo: string,
) {
  const [row] = await db
    .select({
      admissionId: admissionTable.id,
      userId: cadetUser.id,
      passwordHash: cadetAccount.password,
    })
    .from(admissionTable)
    .innerJoin(schoolTable, eq(schoolTable.id, admissionTable.schoolId))
    .leftJoin(cadetUser, eq(cadetUser.admissionId, admissionTable.id))
    .leftJoin(
      cadetAccount,
      and(
        eq(cadetAccount.userId, cadetUser.id),
        eq(cadetAccount.providerId, 'credential'),
        eq(cadetAccount.accountId, cadetUser.id),
      ),
    )
    .where(
      and(
        eq(schoolTable.slug, schoolSlug),
        eq(admissionTable.admissionNo, admissionNo),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type CadetAdmissionSignInOptions = {
  db: DatabaseExecutor;
  limiter: SignInLimiter;
};

/**
 * `POST /api/cadet/auth/sign-in/admission` with
 * `{ schoolSlug, admissionNo, password }`: the only way to sign in to the
 * Cadet Portal.
 *
 * Failed attempts are limited per resolved admission id (5 failures in 15
 * minutes lock that admission's sign-in for 15 minutes) and, more loosely,
 * per client IP. A lock is checked before the password, so a locked
 * admission cannot be probed further. An admission without a cadet login
 * counts failures and locks exactly like one with a login, and attempts
 * that match no login hash the password anyway, so neither the lockout nor
 * timing reveals which admissions have a login.
 */
export function cadetAdmissionSignIn(options: CadetAdmissionSignInOptions) {
  const { db, limiter } = options;
  return {
    id: 'cadet-admission-sign-in',
    endpoints: {
      signInAdmission: createAuthEndpoint(
        CADET_ADMISSION_SIGN_IN_PATH,
        {
          method: 'POST',
          use: [formCsrfMiddleware],
          body: cadetAdmissionSignInBodySchema,
          metadata: {
            openapi: {
              description:
                'Sign in to the Cadet Portal with school code, admission number and password.',
            },
          },
        },
        async (ctx) => {
          const { schoolSlug, admissionNo, password } = ctx.body;
          const ip = ctx.request ? getIP(ctx.request, ctx.context.options) : null;
          const ipKey = ip ? `sign-in:ip:${ip}` : null;

          if (ipKey) {
            const ipLock = await limiter.lockedFor(ipKey);
            if (ipLock > 0) throw tooManyAttempts(ipLock);
          }

          const login = await findCadetLogin(db, schoolSlug, admissionNo);
          if (!login) {
            await ctx.context.password.hash(password);
            if (ipKey) await limiter.recordFailure(ipKey, IP_LIMIT);
            throw new APIError('UNAUTHORIZED', INVALID_CREDENTIALS);
          }

          // A resolved admission is limited and locked the same way whether
          // or not it has a cadet login, so the lockout never reveals which
          // admissions have one.
          const admissionKey = `sign-in:admission:${login.admissionId}`;
          const admissionLock = await limiter.lockedFor(admissionKey);
          if (admissionLock > 0) throw tooManyAttempts(admissionLock);

          let valid = false;
          if (login.userId && login.passwordHash) {
            valid = await ctx.context.password.verify({
              hash: login.passwordHash,
              password,
            });
          } else {
            // No login: spend the same hashing time, then fail like a wrong password.
            await ctx.context.password.hash(password);
          }
          if (!valid || !login.userId) {
            if (ipKey) await limiter.recordFailure(ipKey, IP_LIMIT);
            await limiter.recordFailure(admissionKey, ADMISSION_LIMIT);
            throw new APIError('UNAUTHORIZED', INVALID_CREDENTIALS);
          }
          await limiter.clearFailures(admissionKey);

          const user = await ctx.context.internalAdapter.findUserById(
            login.userId,
          );
          const session = user
            ? await ctx.context.internalAdapter.createSession(user.id)
            : null;
          if (!user || !session) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              code: 'CADET_SESSION_FAILED',
              message: 'Unable to sign in right now. Try again.',
            });
          }
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ redirect: false, token: session.token });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
