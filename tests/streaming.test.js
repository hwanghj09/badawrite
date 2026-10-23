import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/script.js';
import { synthesize } from '../src/audio.js';

test('question 1 is available while questions 2 through 12 are still pending', async () => {
  let finishSecond;
  const second = new Promise(resolve => { finishSecond = resolve; });
  let firstReady;
  const ready = new Promise(resolve => { firstReady = resolve; });
  let finished = false;
  const previews = [];
  const script = Array.from({ length: 12 }, (_, i) => `${i + 1}번\nW: ${i === 0 ? 'First.' : `Message ${i + 1}.`}`).join('\n');
  const run = synthesize(parseScript(script),
    { turnGap: 0, questionGap: 0 },
    async text => text === 'First.' ? new Float32Array([0.25, 0.5]) : second,
    undefined,
    part => {
      previews.push({ ...part, samples: structuredClone(part.samples, { transfer: [part.samples.buffer] }) });
      if (part.index === 0) firstReady();
    }).then(result => { finished = true; return result; });
  await ready;
  assert.equal(finished, false);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].marker.id, '1');
  assert.deepEqual(previews[0].samples, new Float32Array([0.25, 0.5]));
  finishSecond(new Float32Array([-0.25]));
  const result = await run;
  assert.equal(previews.length, 12);
  assert.deepEqual(result.samples, new Float32Array([0.25, 0.5, ...Array(11).fill(-0.25)]));
});

test('question previews concatenate to the complete track with repeat, pauses and inter-question gaps', async () => {
  const previews = [];
  const result = await synthesize(parseScript('1번\nW: Hello.\n[Pause]\nM: Hi.\n(2 seconds)\n2번\nW: Goodbye.'),
    { turnGap: 0.5, questionGap: 3, repeat: true },
    async () => new Float32Array([0.25, 0.5]), undefined,
    part => previews.push(part));
  const combined = new Float32Array(previews.reduce((sum, p) => sum + p.samples.length, 0));
  let offset = 0;
  for (const preview of previews) { combined.set(preview.samples, offset); offset += preview.samples.length; }
  assert.deepEqual(combined, result.samples);
  assert.deepEqual(previews.map(p => p.marker), result.markers);
  assert.equal(previews[1].marker.start, previews[0].samples.length / 24000);
});

test('completed question remains usable when a later question fails', async () => {
  const previews = [];
  await assert.rejects(synthesize(parseScript('1번\nW: First.\n2번\nM: Second.'),
    { turnGap: 0, questionGap: 0 },
    async text => {
      if (text === 'Second.') throw new Error('Model failed');
      return new Float32Array([0.5]);
    }, undefined, part => previews.push(part)), /Model failed/);
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].samples, new Float32Array([0.5]));
});
