import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createCadetTestClient } from '../../../test/cadet';
import { expectRpcCode } from '../../../test/finance/assertions';
import { createTestSchool } from '../../../test/fixtures';

/** An anonymous caller, as on the sign-in page: no cadet cookie. */
const anonymous = () => createCadetTestClient(new Headers());

/** A unique word so other tests' schools never match the search. */
const uniqueWord = () => `zq${randomUUID().replace(/-/g, '').slice(0, 10)}`;

describe('cadet school search (public)', () => {
  it('answers anonymous callers with name and code only, at most five', async () => {
    const word = uniqueWord();
    for (let index = 0; index < 6; index += 1) {
      await createTestSchool({ name: `${word} School ${index}`, slug: `${word}-${index}` });
    }
    const { schools } = await anonymous().searchSchools({ query: word });
    expect(schools).toHaveLength(5);
    expect(Object.keys(schools[0]!).sort()).toEqual(['logoUrl', 'name', 'slug']);
  });

  it('ranks an exact code first, then names that start with the query', async () => {
    const word = uniqueWord();
    await createTestSchool({ name: `Old ${word} Academy`, slug: `old-${word}` });
    await createTestSchool({ name: `${word} Public School`, slug: `${word}-public` });
    await createTestSchool({ name: 'Exact Code School', slug: word });
    const { schools } = await anonymous().searchSchools({ query: word.toUpperCase() });
    expect(schools.map((school) => school.slug)).toEqual([word, `${word}-public`, `old-${word}`]);
  });

  it('matches LIKE wildcards literally', async () => {
    const word = uniqueWord();
    await createTestSchool({ name: `${word} School`, slug: word });
    expect((await anonymous().searchSchools({ query: `${word.slice(0, 4)}%` })).schools).toEqual([]);
  });

  it('suggests a demo school only for its exact code', async () => {
    const word = uniqueWord();
    await createTestSchool({ name: `${word} Demo`, slug: `${word}-demo`, isDemo: true });
    expect((await anonymous().searchSchools({ query: word })).schools).toEqual([]);
    const exact = await anonymous().searchSchools({ query: `${word}-demo` });
    expect(exact.schools.map((school) => school.slug)).toEqual([`${word}-demo`]);
  });

  it('refuses searches shorter than three characters', async () => {
    await expectRpcCode(anonymous().searchSchools({ query: 'ab' }), 'BAD_REQUEST');
  });

  it('looks one school up by its exact code, with a presigned logo when it has one', async () => {
    const word = uniqueWord();
    await createTestSchool({ name: `${word} School`, slug: word, logoS3Key: `schools/${word}/logo.png` });
    const school = await anonymous().getSignInSchool({ slug: word.toUpperCase() });
    expect(school).toMatchObject({ slug: word, name: `${word} School` });
    expect(school.logoUrl).toContain('X-Amz-Expires=300');
    await expectRpcCode(anonymous().getSignInSchool({ slug: `${word}-missing` }), 'NOT_FOUND');
  });
});
