import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadExamAudio } from '../src/exam-audio.js';
import { synthesize, SAMPLE_RATE } from '../src/audio.js';
import { parseScript, encodeWav, joinWav } from '../src/script.js';

test('original clips validate, retry failed loads and cache successful decoding', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++;
    if (calls <= 2) return new Response('Unavailable', { status: 503 });
    if (calls <= 4) return new Response('<html>missing</html>');
    return new Response(await readFile(new URL(`../public${url}`, import.meta.url)));
  });
  await assert.rejects(loadExamAudio(), /불러오지/);
  await assert.rejects(loadExamAudio(), /올바르지/);
  const clips = await loadExamAudio();
  assert.equal(clips.intro.length, 11.3 * SAMPLE_RATE);
  assert.equal(clips.chime.length, Math.round(2.2 * SAMPLE_RATE));
  assert.ok(clips.intro.some(value => Math.abs(value) > 0.01));
  assert.ok(clips.chime.some(value => Math.abs(value) > 0.01));
  assert.equal(await loadExamAudio(), clips);
  assert.equal(calls, 6);
});

test('original introduction plays once and original chime replaces synthetic cue in previews and final WAV', async () => {
  const intro = new Float32Array([0.125, 0.25]);
  const chime = new Float32Array([-0.5, -0.25]);
  const questions = parseScript('1번\n[Chime bell rings.]\nW: Hello.\n2번\nM: Hi.');
  const settings = { intro, chime, repeat: true, turnGap: 0, questionGap: 0 };
  const speak = async () => new Float32Array([0.5]);
  const full = await synthesize(questions, settings, speak);
  const parts = [];
  const streamed = await synthesize(questions, { ...settings, streamOnly: true }, speak, undefined,
    ({ samples }) => parts.push(new Blob([encodeWav(samples)])));
  assert.deepEqual(full.samples.slice(0, 5), new Float32Array([0.125, 0.25, -0.5, -0.25, 0.5]));
  assert.equal(full.samples.length, intro.length + 2 * (chime.length + 1) + 2 + 6 * SAMPLE_RATE);
  assert.equal(streamed.markers[0].start, 0);
  assert.equal(streamed.markers[1].start, (parts[0].size - 44) / 2 / SAMPLE_RATE);
  assert.deepEqual(await joinWav(parts).arrayBuffer(), encodeWav(full.samples));
});

test('automatic question chime precedes Korean, plays once despite repeats, and matches preview and saved WAV', async () => {
  const questions = parseScript('1번\n[Chime bell rings.]\nW: Hello.\n2번\nM: Hi. [Chime bell rings.] Goodbye.');
  questions[0].repeat = 2;
  for (const q of questions) q.questionPrompts = [{ id: q.id, prompt: '다음을 듣고 답하시오.' }];
  const settings = { questionChime: true, intro: new Float32Array([0.875]), chime: new Float32Array([0.75]), turnGap: 0, questionGap: 0 };
  const speak = async () => new Float32Array([0.25]);
  const korean = async () => new Float32Array([0.5]);
  const full = await synthesize(questions, settings, speak, undefined, undefined, korean);
  assert.deepEqual([...full.samples.slice(0, 3)], [0.875, 0.75, 0.5]);
  assert.equal([...full.samples].filter(x => x === 0.75).length, 3); // 2 question starts + 1 inline cue.
  assert.equal([...full.samples].filter(x => x === 0.5).length, 2);
  const parts = [];
  const streamed = await synthesize(questions, { ...settings, streamOnly: true }, speak, undefined,
    ({ samples }) => parts.push(new Blob([encodeWav(samples)])), korean);
  assert.deepEqual(streamed.markers, full.markers);
  assert.deepEqual(await joinWav(parts).arrayBuffer(), encodeWav(full.samples));
});
