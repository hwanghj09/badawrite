import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/script.js';
import { synthesize, chime, SAMPLE_RATE, VOICES } from '../src/audio.js';
import { textFromPdfItems } from '../src/pdf-text.js';
import { outputNames } from '../src/batch.js';
import { fileKind } from '../src/read-files.js';
import { zipSync, unzipSync } from 'fflate';

test('W monologue keeps its role across wrapped lines and excludes bell and waiting instructions', () => {
  const [q] = parseScript('[Chime bell rings.]\nW: Good morning, students.\nThis is the vice principal.\nThank you for listening.\n(10 seconds)');
  assert.equal(q.turns.length, 2);
  assert.equal(q.turns[0].type, 'chime');
  assert.equal(q.turns[1].speaker, 'W');
  assert.equal(q.turns[1].text, 'Good morning, students. This is the vice principal. Thank you for listening.');
  assert.equal(q.endPause, 10);
});
test('inline question and alternating role labels keep both speakers and inline pause', () => {
  const [q] = parseScript('1. W: How are you? M: Fine. [Pause] Thank you.\nW： Great.');
  assert.deepEqual(q.turns.map(t => t.speaker || t.type), ['W', 'M', 'pause', 'M', 'W']);
  assert.equal(q.turns[3].text, 'Thank you.');
});
test('PDF shared passage repeated in source is retained once and scheduled exactly twice', () => {
  const [q] = parseScript('Signal M Up - Down\nANN: 안내방송입니다.\n16번부터 17번까지는 두 번 들려줍니다.\n16번과 17번\n다음을 듣고 답하시오.\nW: Welcome, students.\nToday we study buildings.\n다시 한 번 듣겠습니다.\nW: Welcome, students.\nToday we study buildings.\n16번\n주제를 고르시오.\n(10 seconds)\n17번\n내용을 고르시오.\n(10 seconds)\n6 6');
  assert.equal(q.id, '16–17'); assert.equal(q.repeat, 2); assert.equal(q.turns.length, 1); assert.equal(q.endPause, 20);
  assert.ok(!q.turns[0].text.includes('Signal'));
});
test('unimplemented stage effects are flagged and never spoken', () => {
  const [q] = parseScript('M: Hello. [Phone rings.] Goodbye.');
  assert.ok(q.warnings[0].includes('Phone rings'));
  assert.equal(q.turns.map(t => t.text).join(' '), 'Hello. Goodbye.');
});
test('OCR joined role labels and short numeric or single-letter replies are retained', () => {
  const [q] = parseScript('1. [Chime bell rings.]W: 50. M: I.\n1\n6');
  assert.deepEqual(q.turns.filter(t => t.speaker), [{ speaker: 'W', text: '50.' }, { speaker: 'M', text: 'I.' }]);
});
test('audio uses the real W/M voices, synthesizes cues, and preserves timed silence', async () => {
  const spoken = [];
  const q = parseScript('1번\n[Chime bell rings.]\nW: Hello.\nM: Hi.\n(2 seconds)');
  const result = await synthesize(q, { turnGap: 0.5, questionGap: 5 }, async (text, voice) => { spoken.push({ text, voice }); return new Float32Array(SAMPLE_RATE).fill(0.1); });
  assert.deepEqual(spoken, [{ text: 'Hello.', voice: VOICES.W }, { text: 'Hi.', voice: VOICES.M }]);
  assert.equal(result.samples.length, 6 * SAMPLE_RATE);
  assert.equal(result.markers[0].end, 4);
  assert.ok(result.samples.slice(-2 * SAMPLE_RATE).every(x => x === 0));
  assert.ok(chime().some(x => x !== 0));
});
test('global repeat and passage repeat do not multiply to four plays', async () => {
  const q = parseScript('[16~17]\nM: Hello.'); let calls = 0;
  const result = await synthesize(q, { repeat: true, turnGap: 0, questionGap: 0 }, async () => { calls++; return new Float32Array(SAMPLE_RATE); }, undefined, undefined, async () => new Float32Array([0.5]));
  assert.equal(calls, 1); assert.equal(result.samples.length, 8 * SAMPLE_RATE + 3);
});
test('PDF line and role boundaries survive split text runs', () => {
  const text = textFromPdfItems([
    { str: '1번', transform: [1, 0, 0, 1, 10, 100], hasEOL: true },
    { str: 'W:', transform: [1, 0, 0, 1, 10, 90] },
    { str: 'Hello.', transform: [1, 0, 0, 1, 30, 90], hasEOL: true },
    { str: 'M: Hi.', transform: [1, 0, 0, 1, 10, 80], hasEOL: true },
  ]);
  assert.deepEqual(parseScript(text)[0].turns.map(t => t.speaker), ['W', 'M']);
});
test('batch preserves duplicate filenames, Korean names, and separates identical question numbers', () => {
  const names = outputNames([{ name: '듣기.pdf' }, { name: '듣기.png' }, { name: '../듣기.txt' }]);
  assert.deepEqual(names, ['듣기.wav', '듣기 (2).wav', '.._듣기.wav']);
  const archive = unzipSync(zipSync({ [names[0]]: new Uint8Array([1]), [names[1]]: new Uint8Array([2]) }, { level: 0 }));
  assert.equal(archive[names[0]][0], 1); assert.equal(archive[names[1]][0], 2);
  assert.equal(parseScript('1번\nW: First.')[0].id, parseScript('1번\nM: Second.')[0].id);
  assert.equal(fileKind({ name: 'exam.PDF', type: '' }), 'pdf');
  assert.throws(() => fileKind({ name: 'bad.exe', type: '' }), /PDF/);
});
