import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesize, resampleAudio, SAMPLE_RATE } from '../src/audio.js';
import { encodeWav, joinWav } from '../src/script.js';

const settings = { turnGap: 0, questionGap: 0 };
const question = (id = '1') => ({
  id, questionPrompts: [{ id, prompt: '다음 중 적절하지 않은 것을 고르시오.' }],
  options: ['① 보기', '② 보기'], answer: '②', turns: [{ speaker: 'W', text: 'Hello.' }],
});

test('Korean question is included once before repeated English in track, preview and WAV', async () => {
  const korean = [];
  const english = [];
  const previews = [];
  const result = await synthesize([question()], { ...settings, repeat: true },
    async text => { english.push(text); return new Float32Array([0.25]); }, undefined,
    part => previews.push(part),
    async text => { korean.push(text); return new Float32Array([0.5, -0.5]); });
  assert.deepEqual(korean, ['일번. 다음 중 적절하지 않은 것을 고르시오.']);
  assert.deepEqual(english, ['Hello.']);
  assert.deepEqual(previews[0].samples, result.samples);
  assert.equal(result.markers[0].start, 0);
  assert.equal(result.markers[0].end, result.samples.length / SAMPLE_RATE);
  assert.deepEqual([...result.samples.slice(0, 2)], [0.5, -0.5]);
  assert.equal(result.samples[2 + 0.7 * SAMPLE_RATE], 0.25);
  assert.equal(result.samples.at(-1), 0.25);
  const wav = encodeWav(result.samples);
  const view = new DataView(wav);
  assert.equal(view.getInt16(44, true), Math.trunc(0.5 * 32767));
  assert.equal(wav.byteLength, 44 + result.samples.length * 2);
});

test('shared question range is spoken naturally and question markers include Korean prefix', async () => {
  const spoken = [];
  const result = await synthesize([question('1'), question('16–17')], { ...settings, questionGap: 1 },
    async () => new Float32Array([0.25]), undefined, undefined,
    async text => { spoken.push(text); return new Float32Array([0.5]); });
  assert.equal(spoken[1], '십육번과 십칠번. 다음 중 적절하지 않은 것을 고르시오.');
  const secondStart = Math.round(result.markers[1].start * SAMPLE_RATE);
  assert.equal(result.samples[secondStart], 0.5);
  assert.equal(secondStart, Math.round(result.markers[0].end * SAMPLE_RATE) + SAMPLE_RATE);
});

test('stream-only Korean previews join to the same repeated two-question WAV as full synthesis', async () => {
  const questions = [question('1'), { ...question('16–17'), repeat: 2 }];
  const options = { ...settings, repeat: true, questionGap: 1 };
  const speak = async () => new Float32Array([0.25, -0.25]);
  const speakKorean = async () => new Float32Array([0.5, -0.5]);
  const full = await synthesize(questions, options, speak, undefined, undefined, speakKorean);
  const previews = [];
  const spoken = [];
  const streamed = await synthesize(questions, { ...options, streamOnly: true }, speak, undefined,
    ({ samples }) => previews.push(new Blob([encodeWav(samples)])),
    async text => { spoken.push(text); return speakKorean(text); });
  assert.equal(streamed.samples, undefined);
  assert.deepEqual(streamed.markers, full.markers);
  assert.deepEqual(spoken, ['일번. 다음 중 적절하지 않은 것을 고르시오.', '십육번과 십칠번. 다음 중 적절하지 않은 것을 고르시오.']);
  assert.equal(previews.length, 2);
  assert.deepEqual(new Uint8Array(await joinWav(previews).arrayBuffer()), new Uint8Array(encodeWav(full.samples)));
});

test('attached prompts fail clearly when Korean speech is unavailable or invalid', async () => {
  const speak = async () => new Float32Array([0.25]);
  await assert.rejects(synthesize([question()], settings, speak), /한국어 질문 음성/);
  for (const audio of [new Float32Array(), new Float32Array([NaN]), new Float32Array([Infinity]), [0.5]]) {
    await assert.rejects(synthesize([question()], settings, speak, undefined, undefined, async () => audio), error => error.korean === true && /한국어 질문 음성/.test(error.message));
  }
});

test('resampleAudio converts 16 kHz PCM to 24 kHz with interpolation and stable constant audio', () => {
  assert.deepEqual([...resampleAudio(new Float32Array([0, 1, 2, 3]), 16000)], [0, 2 / 3, 4 / 3, 2, 8 / 3, 3].map(Math.fround));
  const constant = resampleAudio(new Float32Array(16).fill(0.25), 16000);
  assert.equal(constant.length, 24);
  assert.ok(constant.every(value => value === 0.25));
  const empty = new Float32Array();
  assert.equal(resampleAudio(empty, 16000), empty);
  const same = new Float32Array([0.2]);
  assert.equal(resampleAudio(same, SAMPLE_RATE), same);
  for (const rate of [0, -1, NaN, Infinity]) {
    assert.throws(() => resampleAudio(empty, rate), /주파수/);
    assert.throws(() => resampleAudio(empty, 16000, rate), /주파수/);
  }
});
