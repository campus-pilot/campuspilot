import { createDb } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { schoolTable } from '@campuspilot/db/schema/school';
import { generateId } from '@campuspilot/db/id';
import { getRedisClient } from '@campuspilot/redis/client';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { createCadetAuth } from '../cadet';
import { issueCadetLogin } from '../cadet-login';
import {
  CADET_ADMISSION_MAX_FAILURES,
  CADET_IP_MAX_FAILURES,
} from '../cadet-policy';
import { createRedisSignInLimiter } from '../cadet-sign-in-limits';
import { auth as staffAuth } from '../server';

const CADET_ORIGIN = 'http://localhost:3004';
const CADET_BASE = 'http://localhost:3000/api/cadet/auth';
const WRONG_PASSWORD = 'wrong-word-11';

const db = createDb();
const redis = getRedisClient();

/**
 * The real Redis limiter under a per-file prefix, so these tests exercise
 * the production counting and lock keys without sharing them with any other
 * test file.
 */
const cadetAuth = createCadetAuth(db, {
  limiter: createRedisSignInLimiter(redis, `test:cadet-limits:${randomUUID()}:`),
});

afterAll(async () => {
  await db.$client.end();
});

/** A fresh client address per test, so one test's IP failures never lock another. */
function testIp() {
  return `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
}

async function createSchool() {
  const slug = `limits-${randomUUID().slice(0, 8)}`;
  const [school] = await db
    .insert(schoolTable)
    .values({ slug, name: `School ${slug}`, location: 'Town' })
    .returning();
  return school!;
}

async function staffUserId() {
  const result = await staffAuth.api.signUpEmail({
    body: {
      email: `staff_${randomUUID()}@example.com`,
      password: 'Password123!',
      name: 'Staff',
    },
  });
  return result.user.id;
}

async function createAdmissionWithLogin(schoolId: string, issuedBy: string) {
  const [admission] = await db
    .insert(admissionTable)
    .values({
      id: generateId('admission'),
      schoolId,
      name: 'Asha Kumari',
      admissionNo: `ADM-${randomUUID().slice(0, 6)}`,
      address: 'Main road',
      phoneNo: '9999999999',
      whatsappSameAsPhone: true,
      dob: '2018-04-01',
      fatherName: 'Father',
      motherName: 'Mother',
    })
    .returning();
  const issued = await issueCadetLogin(db, {
    admissionId: admission!.id,
    issuedBy,
  });
  return { admissionNo: admission!.admissionNo, password: issued.password };
}

async function signIn(body: Record<string, unknown>, ip: string) {
  const response = await cadetAuth.handler(
    new Request(`${CADET_BASE}/sign-in/admission`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: CADET_ORIGIN,
        'x-forwarded-for': ip,
      },
      body: JSON.stringify(body),
    }),
  );
  const { code } = (await response.json()) as { code?: string };
  return { status: response.status, code };
}

describe('Redis sign-in limiter', () => {
  const limit = { maxFailures: 3, windowSeconds: 60, lockSeconds: 120 };

  it('locks a key on the last allowed failure, resets its count and reports the lock', async () => {
    const limiter = createRedisSignInLimiter(redis, `test:limiter:${randomUUID()}:`);
    expect(await limiter.lockedFor('a')).toBe(0);
    expect(await limiter.recordFailure('a', limit)).toBe(false);
    expect(await limiter.recordFailure('a', limit)).toBe(false);
    expect(await limiter.lockedFor('a')).toBe(0);
    expect(await limiter.recordFailure('a', limit)).toBe(true);
    const locked = await limiter.lockedFor('a');
    expect(locked).toBeGreaterThan(limit.windowSeconds);
    expect(locked).toBeLessThanOrEqual(limit.lockSeconds);
    // Other keys are unaffected.
    expect(await limiter.lockedFor('b')).toBe(0);
  });

  it('clears the failure count, so later failures start from zero', async () => {
    const limiter = createRedisSignInLimiter(redis, `test:limiter:${randomUUID()}:`);
    await limiter.recordFailure('a', limit);
    await limiter.recordFailure('a', limit);
    await limiter.clearFailures('a');
    expect(await limiter.recordFailure('a', limit)).toBe(false);
    expect(await limiter.recordFailure('a', limit)).toBe(false);
    expect(await limiter.lockedFor('a')).toBe(0);
  });

  it('starts the window at the first failure only', async () => {
    const prefix = `test:limiter:${randomUUID()}:`;
    const limiter = createRedisSignInLimiter(redis, prefix);
    await limiter.recordFailure('a', { ...limit, windowSeconds: 60 });
    // A later failure with a longer window must not extend the first one.
    await limiter.recordFailure('a', { ...limit, windowSeconds: 600 });
    const ttl = await redis.ttl(`${prefix}a:failures`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});

describe('cadet sign-in per-IP failure limit', () => {
  it(`locks an IP after ${CADET_IP_MAX_FAILURES} failures across admissions, for that IP only`, async () => {
    const school = await createSchool();
    const issuedBy = await staffUserId();
    const target = await createAdmissionWithLogin(school.id, issuedBy);
    const ip = testIp();

    // Unknown admission numbers count against the IP but lock no admission.
    for (let index = 0; index < CADET_IP_MAX_FAILURES; index += 1) {
      const attempt = await signIn(
        { schoolSlug: school.slug, admissionNo: `NOPE-${index}`, password: WRONG_PASSWORD },
        ip,
      );
      expect(attempt.status).toBe(401);
    }

    // Even the right password is refused from the locked IP...
    expect(
      await signIn({ schoolSlug: school.slug, ...target }, ip),
    ).toEqual({ status: 429, code: 'CADET_SIGN_IN_LOCKED' });
    // ...while the same admission still signs in from another address.
    expect(
      (await signIn({ schoolSlug: school.slug, ...target }, testIp())).status,
    ).toBe(200);
  });

  it('counts failed attempts only: successful sign-ins neither count nor reset the IP count', async () => {
    const school = await createSchool();
    const issuedBy = await staffUserId();
    const target = await createAdmissionWithLogin(school.id, issuedBy);
    const ip = testIp();

    for (let index = 0; index < CADET_IP_MAX_FAILURES - 1; index += 1) {
      const attempt = await signIn(
        { schoolSlug: school.slug, admissionNo: `NOPE-${index}`, password: WRONG_PASSWORD },
        ip,
      );
      expect(attempt.status).toBe(401);
      // Interleaved successes from the same address (a shared school lab).
      if (index % 5 === 0) {
        expect((await signIn({ schoolSlug: school.slug, ...target }, ip)).status).toBe(200);
      }
    }
    // More successes than the IP limit would ever allow failures still pass.
    for (let index = 0; index < CADET_IP_MAX_FAILURES + 1; index += 1) {
      expect((await signIn({ schoolSlug: school.slug, ...target }, ip)).status).toBe(200);
    }

    // The last allowed failure locks the IP: successes never reset the count.
    expect(
      (await signIn({ schoolSlug: school.slug, admissionNo: 'NOPE-LAST', password: WRONG_PASSWORD }, ip)).status,
    ).toBe(401);
    expect(
      await signIn({ schoolSlug: school.slug, ...target }, ip),
    ).toEqual({ status: 429, code: 'CADET_SIGN_IN_LOCKED' });
  });

  it('keeps the per-admission lock separate from the per-IP limit', async () => {
    const school = await createSchool();
    const issuedBy = await staffUserId();
    const locked = await createAdmissionWithLogin(school.id, issuedBy);
    const other = await createAdmissionWithLogin(school.id, issuedBy);
    const ip = testIp();

    for (let index = 0; index < CADET_ADMISSION_MAX_FAILURES; index += 1) {
      const attempt = await signIn(
        { schoolSlug: school.slug, admissionNo: locked.admissionNo, password: WRONG_PASSWORD },
        ip,
      );
      expect(attempt.status).toBe(401);
    }

    // The admission is locked from every address...
    expect(
      await signIn({ schoolSlug: school.slug, ...locked }, testIp()),
    ).toEqual({ status: 429, code: 'CADET_SIGN_IN_LOCKED' });
    // ...but the IP that caused it is far below its own limit, so another
    // admission still signs in from it.
    expect((await signIn({ schoolSlug: school.slug, ...other }, ip)).status).toBe(200);
  });
});
