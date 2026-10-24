import test from 'node:test';
import assert from 'node:assert/strict';
import { planListening, estimateQuestionDuration, speechWork } from '../src/listening-plan.js';
import { parseScript } from '../src/script.js';

const samples = seconds => [{ work: 100, seconds: 200 }, { work: 100, seconds }];
const exam = ready => Array.from({ length: 17 }, (_, i) => ({ ready: i < ready, duration: 900 / 17, work: 100 }));

test('a roughly 15-minute exam starts before completion on fast devices, buffers more on slow devices', () => {
  const fast = planListening({ items: exam(2), samples: samples(5) });
  assert.equal(fast.canStart, true);
  assert.equal(Math.round(fast.totalSeconds), 900);
  const slow = planListening({ items: exam(2), samples: samples(90) });
  assert.equal(slow.canStart, false);
  assert.ok(slow.waitSeconds > 0);
  assert.equal(planListening({ items: exam(14), samples: samples(90) }).canStart, true);
});

test('every question deadline is checked even if the final audio is longer than remaining generation', () => {
  const plan = planListening({ items: [
    { ready: true, duration: 1, work: 100 }, { ready: true, duration: 1, work: 100 },
    { ready: false, duration: 900, work: 1000 },
  ], samples: samples(10) });
  assert.ok(plan.generationSeconds < plan.totalSeconds);
  assert.equal(plan.canStart, false);
  assert.ok(plan.waitSeconds >= 130);
});

test('one ready question waits for a speed measurement; fully ready short files start immediately', () => {
  assert.equal(planListening({ items: exam(1), samples: samples(1) }).canStart, false);
  assert.equal(planListening({ items: exam(0) }).waitSeconds, null);
  assert.equal(planListening({ items: exam(17) }).canStart, true);
  assert.equal(planListening({ items: [{ ready: true, duration: 1, work: 1 }] }).canStart, true);
  assert.equal(planListening({ items: [] }).canStart, false);
});

test('faster playback and slower generation increase buffering; stalled tasks cannot count down indefinitely', () => {
  const normal = planListening({ items: exam(4), samples: samples(45) });
  const fastPlayback = planListening({ items: exam(4), samples: samples(45), playbackRate: 1.25 });
  assert.ok(fastPlayback.waitSeconds >= normal.waitSeconds);
  assert.ok(fastPlayback.totalSeconds < normal.totalSeconds);
  const stalled = planListening({ items: exam(2), samples: samples(5), elapsed: 400 });
  assert.equal(stalled.canStart, false);
  assert.ok(stalled.waitSeconds > 0);
});

test('duration estimates include the intro, one question cue, pauses, gaps and repeated English', () => {
  const [q] = parseScript('[16~17]\n[Chime bell rings.]\nW: Hello.\n[Pause]');
  q.questionPrompts = [{ id: '16', prompt: '무엇인가요?' }];
  const base = { turnGap: 0.5, questionGap: 5, questionChime: true, examAudio: true };
  const estimated = estimateQuestionDuration(q, base);
  assert.ok(estimated > 11.3 + 2.2 + 3 + 5);
  assert.equal(estimateQuestionDuration(q, { ...base, repeat: true }), estimated);
  assert.equal(estimated - estimateQuestionDuration(q, base, 0, true), 5);
  assert.equal(estimated - estimateQuestionDuration(q, base, 1), 11.3);
  assert.ok(speechWork(q, true) < speechWork(q, false));
});
