import { randomUUID } from 'node:crypto';

import { db } from '@campuspilot/db';
import { account } from '@campuspilot/db/schema/auth';

import { createTestClient, createTestUser, createUserSession, type TestClient, type UserSession } from './fixtures';

/**
 * Test helpers for personal spaces (docs/personal-space.md): people with a
 * linked Google account, which is what makes someone eligible.
 */

/** Links a Google account to a user, as a Google sign-in would. */
export async function linkGoogleAccount(userId: string) {
  await db.insert(account).values({
    id: randomUUID(),
    accountId: `google-${randomUUID()}`,
    providerId: 'google',
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** A signed-in person who signed up with Google and belongs to no school. */
/** A Google newcomer: who they are, their session and their client. */
export type GoogleNewcomer = { userId: string; session: UserSession; client: TestClient };

export async function googleNewcomer(name = 'Asha Verma'): Promise<GoogleNewcomer> {
  const person = await createTestUser({ name });
  await linkGoogleAccount(person.id);
  const session: UserSession = createUserSession(person);
  return { userId: person.id, session, client: createTestClient(session) };
}

/** A Google newcomer with their personal space created. */
export async function personalSpaceOwner(name?: string): Promise<GoogleNewcomer & { schoolId: string }> {
  const person = await googleNewcomer(name);
  const { schoolId } = await person.client.personalSpace.create();
  return { ...person, schoolId };
}
