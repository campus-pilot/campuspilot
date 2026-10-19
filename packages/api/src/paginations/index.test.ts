import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createListInputSchema,
  createNextPageCursor,
  createPaginatedOutputSchema,
  createPaginatedResult,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  paginationMetadataSchema,
  resolvePaginationInput,
} from './index';

describe('pagination helpers', () => {
  const listInputSchema = createListInputSchema({
    searchQuery: z.string().trim().max(20).optional(),
  });

  it('defaults to the first page and the shared page size', () => {
    const input = listInputSchema.parse({});

    expect(input).toEqual({ limit: DEFAULT_LIST_LIMIT });
    expect(resolvePaginationInput(input)).toEqual({
      currentPage: 1,
      pageSize: DEFAULT_LIST_LIMIT,
      offset: 0,
    });
  });

  it('resolves one-based page input to the correct offset', () => {
    expect(resolvePaginationInput({ page: 3, limit: 7 })).toEqual({
      currentPage: 3,
      pageSize: 7,
      offset: 14,
    });
  });

  it('resolves a cursor as the next one-based page', () => {
    const input = listInputSchema.parse({ cursor: '4', limit: 5 });

    expect(resolvePaginationInput(input)).toEqual({
      currentPage: 4,
      pageSize: 5,
      offset: 15,
    });
  });

  it.each([
    { cursor: '0' },
    { cursor: '-1' },
    { cursor: '01' },
    { cursor: '1.5' },
    { cursor: 'page-2' },
    { cursor: '9'.repeat(400) },
  ])('rejects an invalid cursor: $cursor', (input) => {
    expect(listInputSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { page: Number.MAX_SAFE_INTEGER + 1 },
    { limit: 0 },
    { limit: 1.5 },
    { limit: MAX_LIST_LIMIT + 1 },
  ])('rejects an invalid numeric boundary: $page $limit', (input) => {
    expect(listInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects callers that provide both cursor and page', () => {
    const parsed = listInputSchema.safeParse({ cursor: '2', page: 2 });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['cursor'],
            message: 'Pass either cursor or page, not both.',
          }),
        ]),
      );
    }
  });

  it('keeps resource fields in the shared list schema', () => {
    expect(listInputSchema.parse({ searchQuery: '  Ada  ', limit: 3 })).toEqual({
      searchQuery: 'Ada',
      limit: 3,
    });
  });

  it('creates the next cursor only when another page exists', () => {
    expect(createNextPageCursor(1, 3)).toBe('2');
    expect(createNextPageCursor(3, 3)).toBeNull();
    expect(createNextPageCursor(4, 3)).toBeNull();
  });

  it('wraps items with complete pagination metadata', () => {
    expect(
      createPaginatedResult({
        items: [{ id: 'one' }],
        nextCursor: '2',
        currentPage: 1,
        totalPages: 2,
        totalItems: 3,
        pageSize: 2,
      }),
    ).toEqual({
      items: [{ id: 'one' }],
      pagination: {
        nextCursor: '2',
        currentPage: 1,
        totalPages: 2,
        totalItems: 3,
        pageSize: 2,
      },
    });
  });

  it('validates paginated output items and metadata', () => {
    const outputSchema = createPaginatedOutputSchema(
      z.object({ id: z.string().min(1) }),
    );
    const valid = {
      items: [{ id: 'one' }],
      pagination: {
        nextCursor: null,
        currentPage: 1,
        totalPages: 1,
        totalItems: 1,
        pageSize: 20,
      },
    };

    expect(outputSchema.parse(valid)).toEqual(valid);
    expect(
      outputSchema.safeParse({ ...valid, items: [{ id: '' }] }).success,
    ).toBe(false);
    expect(
      paginationMetadataSchema.safeParse({
        ...valid.pagination,
        totalItems: -1,
      }).success,
    ).toBe(false);
  });
});
