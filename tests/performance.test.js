import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, splitSpeech } from '../src/script.js';
import { synthesize, SAMPLE_RATE, VOICES } from '../src/audio.js';
import { cacheSpeech } from '../src/speech-cache.js';

test('short sentences share one inference without losing text or exceeding the chunk limit', () => {
  const text = 'Good morning, students. Our book fair opens tomorrow. Please bring your favorite books to the library. Thank you for joining us.';
  assert.deepEqual(splitSpeech(text), [text]);
  const long = `${text} ${text} ${'This sentence has many words and continues for a while '.repeat(12)}`.trim();
  const chunks = splitSpeech(long);
  assert.equal(chunks.join(' '), long);
  assert.ok(chunks.every(chunk => chunk.length <= 200));
  assert.throws(() => splitSpeech(`Hello. ${'x'.repeat(201)}`), /OCR/);
});

test('changing gaps and repeat reuses speech while producing independent, correctly timed tracks', async () => {
  let calls = 0;
  const speak = cacheSpeech(async (_, voice) => {
    calls++;
    return new Float32Array(SAMPLE_RATE).fill(voice === VOICES.W ? 0.25 : -0.25);
  });
  const questions = parseScript('1번\nW: Good morning. Welcome to our school.\nM: Thank you.');
  const first = await synthesize(questions, { turnGap: 0.5, questionGap: 0 }, speak);
  assert.equal(calls, 2);
  assert.equal(first.samples.length, 2.5 * SAMPLE_RATE);
  // The worker transfers the finished track to the UI; cached speech must survive that transfer.
  const transferred = structuredClone(first.samples, { transfer: [first.samples.buffer] });
  assert.equal(first.samples.byteLength, 0);
  const second = await synthesize(questions, { turnGap: 1, questionGap: 0, repeat: true }, speak);
  assert.equal(calls, 2);
  assert.equal(second.samples.length, 9 * SAMPLE_RATE);
  assert.deepEqual(second.markers, [{ id: '1', start: 0, end: 9 }]);
  assert.ok(second.samples.subarray(SAMPLE_RATE, 2 * SAMPLE_RATE).every(n => n === 0));
  assert.ok(second.samples.subarray(3 * SAMPLE_RATE, 6 * SAMPLE_RATE).every(n => n === 0));
  assert.equal(second.samples[0], 0.25);
  assert.equal(second.samples[2 * SAMPLE_RATE], -0.25);
  assert.deepEqual(second.samples.subarray(0, 3 * SAMPLE_RATE), second.samples.subarray(6 * SAMPLE_RATE));
  assert.equal(transferred[0], 0.25);
});

test('speech cache distinguishes voices, evicts least recently used audio, and skips oversized clips', async () => {
  const calls = [];
  const speak = cacheSpeech(async (text, voice) => {
    calls.push([text, voice]);
    return new Float32Array(text === 'large' ? 5 : 2);
  }, 16);
  await speak('Hello', 'W'); await speak('Hello', 'M');
  await speak('Hello', 'W'); // W becomes most recently used.
  await speak('Bye', 'W'); // Evicts M; total retained PCM stays within 16 bytes.
  await speak('Hello', 'W');
  assert.equal(calls.length, 3);
  await speak('Hello', 'M');
  assert.equal(calls.length, 4);
  await speak('large', 'W'); await speak('large', 'W');
  assert.equal(calls.length, 6);
  await speak('Hello', 'W');
  assert.equal(calls.length, 6);
});

test('failed inference is retried rather than retained as a failed cache entry', async () => {
  let calls = 0;
  const speak = cacheSpeech(async () => {
    if (++calls === 1) throw new Error('Temporary model failure');
    return new Float32Array([0.5]);
  });
  await assert.rejects(speak('Hello', 'W'), /Temporary/);
  assert.deepEqual(await speak('Hello', 'W'), new Float32Array([0.5]));
  await speak('Hello', 'W');
  assert.equal(calls, 2);
});
