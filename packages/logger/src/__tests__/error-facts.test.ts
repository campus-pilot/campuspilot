import { describe, expect, it } from 'vitest';

import { errorFacts } from '../error-facts';

describe('errorFacts', () => {
  it("keeps the class, the code and the constraint along the cause chain, never the message", () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505', constraint: 'school_slug_unique', detail: 'Key (name)=(Asha) exists.' });
    const error = new Error("Failed query: insert into school values ($1) params: Asha's personal school", { cause });
    error.name = 'DrizzleQueryError';
    const facts = errorFacts(error);
    expect(facts).toEqual({ errorName: 'DrizzleQueryError', errorCode: '23505', errorConstraint: 'school_slug_unique' });
    expect(JSON.stringify(facts)).not.toContain('Asha');
  });

  it('describes a thrown non-error by its type', () => {
    expect(errorFacts('boom')).toEqual({ errorName: 'string' });
  });

  it('stops on a cyclic cause chain', () => {
    const error = new Error('a') as Error & { cause?: unknown };
    error.cause = error;
    expect(errorFacts(error)).toEqual({ errorName: 'Error' });
  });
});
