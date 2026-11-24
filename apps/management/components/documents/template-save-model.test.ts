import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initialSaveFootprint } from './template-save-model';

const loaded = '<div>{{bill.number}}</div>';

test('keeps the footprint of the loaded revision when its HTML is saved unchanged', () => {
  assert.equal(initialSaveFootprint({ choosable: true, content: loaded, loadedContent: loaded, pageSize: 'half' }), 'half');
  assert.equal(initialSaveFootprint({ choosable: true, content: loaded, loadedContent: loaded, pageSize: 'full' }), 'full');
});

test('starts unselected when the HTML differs from the loaded revision, whatever the editor shows', () => {
  // A half-A4 marketplace design with a different design pasted over it.
  assert.equal(initialSaveFootprint({ choosable: true, content: '<main>pasted</main>', loadedContent: loaded, pageSize: 'half' }), null);
  assert.equal(initialSaveFootprint({ choosable: true, content: `${loaded} `, loadedContent: loaded, pageSize: 'full' }), null);
});

test('never asks for a type without a footprint choice', () => {
  assert.equal(initialSaveFootprint({ choosable: false, content: '<main>new</main>', loadedContent: loaded, pageSize: 'full' }), 'full');
});
