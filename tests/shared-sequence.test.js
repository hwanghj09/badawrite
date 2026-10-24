import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, encodeWav, joinWav } from '../src/script.js';
import { attachQuestionPaper, parseQuestionPaper } from '../src/question-paper.js';
import { synthesize, SAMPLE_RATE } from '../src/audio.js';
import { questionSpeechPlan, questionSpeechTexts, questionEndGap } from '../src/listening-sequence.js';
import { finalizeRecording } from '../src/final-recording.js';
import { estimateQuestionDuration } from '../src/listening-plan.js';

const source = '[16~17] 다음을 듣고, 물음에 답하시오.\nW: Hello, students.\n다시 한 번 듣겠습니다.\nW: Hello, students.\n16. 여자가 하는 말의 주제로 가장 적절한 것은?\n(7 seconds)\n17. 언급되지 않은 것은?\n(9 seconds)';
const options = { turnGap: 0, questionGap: 5, sharedQuestionGap: 10, examAudio: false, questionChime: false };

test('full-width range punctuation in official PDFs connects to the shared broadcast', () => {
  for (const separator of ['～', '〜']) {
    const [q] = attachQuestionPaper(parseScript(`16번부터 17번까지는 두 번 들려줍니다.\n[16${separator}17] 다음을 듣고, 물음에 답하시오.\nW: Hello.`),
      parseQuestionPaper(`[16${separator}17] 다음을 듣고, 물음에 답하시오.\n16. 주제로 가장 적절한 것은?\n17. 언급되지 않은 것은?`));
    assert.equal(q.id, '16–17');
    assert.equal(questionSpeechTexts(q).length, 4);
    assert.deepEqual(questionSpeechPlan(q).after.map(item => item.text.slice(0, 4)), ['십육번.', '십칠번.']);
  }
});

test('shared passage keeps individual source pauses when a question paper is attached', () => {
  const [inline] = parseScript(source);
  const [linked] = attachQuestionPaper([inline], parseQuestionPaper('17. 언급되지 않은 것은?\n16. 여자가 하는 말의 주제로 가장 적절한 것은?'));
  assert.deepEqual(inline.turns, [{ speaker: 'W', text: 'Hello, students.' }]);
  assert.equal(inline.endPause, 16);
  const [partial] = attachQuestionPaper([inline], parseQuestionPaper('17. 언급되지 않은 것은?'));
  for (const q of [inline, linked, partial]) {
    const plan = questionSpeechPlan(q, options);
    assert.equal(plan.before.length, 1);
    assert.ok(plan.before[0].startsWith('십육번부터 십칠번까지는 두 번 들려줍니다.'));
    assert.deepEqual(plan.between, ['다시 한 번 듣겠습니다.']);
    assert.deepEqual(plan.after, [
      { text: '십육번. 여자가 하는 말의 주제로 가장 적절한 것은?', pause: 7 },
      { text: '십칠번. 언급되지 않은 것은?', pause: 9 },
    ]);
    assert.equal(questionEndGap(q, options, true), 9);
    assert.equal(questionSpeechTexts(q).length, 4);
  }
});

test('actual preview, final WAV and stream PCM follow intro, bell, common, English, bridge, English, Q16, Q17', async () => {
  const [q] = parseScript(source);
  const texts = questionSpeechTexts(q);
  const values = new Map(texts.map((text, i) => [text, [0.125, 0.25, 0.375, 0.625][i]]));
  const settings = { ...options, repeat: true, intro: new Float32Array([0.875]), questionChime: true, chime: new Float32Array([0.75]) };
  const previews = [], spoken = [], english = [];
  const speak = async text => { english.push(text); return new Float32Array([0.5]); };
  const korean = async text => { spoken.push(text); return new Float32Array([values.get(text)]); };
  const full = await synthesize([q], settings, speak, undefined, part => previews.push(part.samples), korean);
  assert.deepEqual(english, ['Hello, students.']);
  assert.deepEqual(spoken, texts);
  assert.deepEqual(previews[0], full.samples);
  const nonzero = [...full.samples.entries()].filter(([, value]) => value !== 0);
  assert.deepEqual(nonzero.map(([, value]) => value), [0.875, 0.75, 0.125, 0.5, 0.25, 0.5, 0.375, 0.625]);
  assert.equal(nonzero[7][0] - nonzero[6][0] - 1, 7 * SAMPLE_RATE);
  assert.equal(full.samples.length - nonzero[7][0] - 1, 9 * SAMPLE_RATE);
  const parts = [];
  const streamed = await synthesize([q], { ...settings, streamOnly: true }, speak, undefined,
    ({ samples }) => parts.push(new Blob([encodeWav(samples)])), korean);
  assert.deepEqual(streamed.markers, full.markers);
  const expected = new Uint8Array(encodeWav(full.samples));
  assert.deepEqual(new Uint8Array(await joinWav(parts).arrayBuffer()), expected);
  // Cues already checked above; leave automatic cue restoration off for these synthetic assets.
  const final = await finalizeRecording(parts, [q], options);
  assert.deepEqual(new Uint8Array(await final.blob.arrayBuffer()), expected);
  assert.ok(Math.abs(final.markers[0].end - (nonzero[7][0] + 1) / SAMPLE_RATE) < 1e-8);
  assert.equal(final.repaired, 0);
});

test('missing shared questions are not invented and ordinary repeats have no shared announcements', async () => {
  const [shared] = parseScript('[16~17]\nW: Hello.');
  assert.equal(questionSpeechPlan(shared).before.length, 1);
  assert.deepEqual(questionSpeechPlan(shared).after, []);
  assert.deepEqual(questionSpeechTexts(shared).slice(1), ['다시 한 번 듣겠습니다.']);
  await assert.rejects(synthesize([shared], options, async () => new Float32Array([0.5])), /한국어 질문 음성/);
  const [ordinary] = parseScript('2. W: Hello.');
  assert.deepEqual(questionSpeechTexts(ordinary), []);
  const result = await synthesize([ordinary], { ...options, repeat: true }, async () => new Float32Array([0.5]));
  assert.deepEqual([...result.samples].filter(Boolean), [0.5, 0.5]);
});

test('shared answer gaps apply twice and duration estimates include the complete broadcast', () => {
  const [q] = parseScript(source.replaceAll(/\(\d+ seconds\)/g, ''));
  assert.deepEqual(questionSpeechPlan(q, options).after.map(p => p.pause), [10, 10]);
  assert.deepEqual(questionSpeechPlan(q, { ...options, sharedQuestionGap: 5 }).after.map(p => p.pause), [5, 5]);
  const plan = questionSpeechPlan(q, options);
  const expected = questionSpeechTexts(q).reduce((n, text) => n + text.length / 5.5, 0)
    + 0.7 * 2 + 3 + q.turns[0].text.length / 14 * 2 + 20;
  assert.ok(Math.abs(estimateQuestionDuration(q, options) - expected) < 1e-8);
  assert.ok(Math.abs(estimateQuestionDuration(q, options) - estimateQuestionDuration(q, { ...options, sharedQuestionGap: 5 }) - 10) < 1e-8);
  assert.equal(estimateQuestionDuration(q, options), estimateQuestionDuration(q, { ...options, repeat: true }));
  assert.equal(plan.after.length, 2);
});
