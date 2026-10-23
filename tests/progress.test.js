import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateProgress } from '../src/progress.js';

test('remaining time uses measured work and handles preparation and completion', () => {
  assert.deepEqual(estimateProgress(100, 0, 10), { percent: 0, seconds: null });
  assert.deepEqual(estimateProgress(100, 25, 10), { percent: 25, seconds: 30 });
  assert.deepEqual(estimateProgress(100, 100, 40), { percent: 100, seconds: 0 });
  assert.deepEqual(estimateProgress(100, 120, 40), { percent: 100, seconds: 0 });
  assert.deepEqual(estimateProgress(0, 0, 0), { percent: 0, seconds: null });
});
