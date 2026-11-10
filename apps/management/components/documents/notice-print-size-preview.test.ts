import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  marketplaceTemplatePreviewInput,
  noticePreviewPrintSizeSchema,
  noticePrintSizeOptions,
} from './notice-print-size-preview';

test('a marketplace Notice design is previewed at the chosen print size', () => {
  const scope = { schoolId: 'sch_1', documentType: 'notice' as const };
  assert.deepEqual(marketplaceTemplatePreviewInput(scope, 'notice-compact', 'half'), { ...scope, slug: 'notice-compact', printSize: 'half' });
  assert.deepEqual(marketplaceTemplatePreviewInput(scope, 'notice-compact', 'full'), { ...scope, slug: 'notice-compact', printSize: 'full' });
});

test('other designs never send a print size, which the server would refuse', () => {
  const input = marketplaceTemplatePreviewInput({ schoolId: 'sch_1', documentType: 'admit_card' }, 'admit-classic', 'half');
  assert.equal('printSize' in input, false);
});

test('"Preview as" offers exactly the sizes the schema accepts', () => {
  assert.deepEqual(noticePrintSizeOptions.map((option) => option.value), noticePreviewPrintSizeSchema.options);
});
