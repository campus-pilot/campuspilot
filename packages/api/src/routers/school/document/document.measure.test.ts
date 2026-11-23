import { describe, expect, it } from 'vitest';

import { measureDocumentSizes } from './document.render';

/** A template whose every document costs about 100 units per item of `items`. */
const template = '{{#each items}}{{this}}{{/each}}';
const context = (items: number) => ({ items: Array.from({ length: items }, () => 'x'.repeat(98)) });

describe('measureDocumentSizes (review S1: one budget for the whole job)', () => {
  it('measures each document within its share and the job within its total', async () => {
    const sizes = await measureDocumentSizes(template, [context(3), context(2)], { documentBudget: 1_000, jobBudget: 2_000 });
    expect(sizes).toHaveLength(2);
    expect(sizes[0]!.htmlBytes).toBe(3 * 98);
    expect(sizes[0]!.budget).toBeGreaterThan(sizes[1]!.budget);
  });

  it('refuses one document over its share', async () => {
    await expect(measureDocumentSizes(template, [context(20)], { documentBudget: 1_000, jobBudget: 100_000 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a job whose documents together pass the job budget, even when each fits its share', async () => {
    const many = Array.from({ length: 10 }, () => context(5));
    await expect(measureDocumentSizes(template, many, { documentBudget: 1_000, jobBudget: 3_000 })).rejects.toThrow(/more rendering than one PDF can take/);
  });

  it('lets other work run between documents', async () => {
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 0);
    try {
      await measureDocumentSizes(template, Array.from({ length: 50 }, () => context(1)), { documentBudget: 1_000, jobBudget: 100_000 });
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
  });
});
