import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, encodeWav, joinAudio, splitSpeech } from '../src/script.js';

test('parses supplied questions, speakers, choices and answers', () => {
  const q = parseScript('1. 대화를 듣고 답하시오.\nW: Good morning.\nM: Hello.\n① A\n② B\n③ C\n④ D\n⑤ E\n정답: ③');
  assert.equal(q.length, 1); assert.equal(q[0].turns.length, 2);
  assert.equal(q[0].turns[0].speaker, 'W'); assert.equal(q[0].turns[1].speaker, 'M');
  assert.equal(q[0].options.length, 5); assert.equal(q[0].answer, 3);
});
test('OCR spacing, wrapping, combined question and translation exclusion', () => {
  const q = parseScript('[16~17] 다음을 듣고 답하시오.\nW ： Hello there.\nWelcome to our school.\n[해석]\nW: This must not be spoken.\n18번 다음 대화\nM: Next question.');
  assert.equal(q.length, 2); assert.equal(q[0].id, '16–17');
  assert.equal(q[0].turns[0].text, 'Hello there. Welcome to our school.');
  assert.equal(q[1].id, '18');
});
test('plain English works, empty and Korean-only input produce no passages', () => {
  assert.equal(parseScript('Hello, everyone.')[0].turns[0].text, 'Hello, everyone.');
  assert.equal(parseScript('해설만 있는 문서입니다.').length, 0);
  assert.equal(parseScript('').length, 0);
});
test('shared-passage questions stay separate from the title and exclude the closing announcement', () => {
  for (const separator of ['\n', ' ']) {
    const [q, next] = parseScript(`16번과 17번\n다음을 듣고, 물음에 답하시오.\nW: Welcome, students.\n16번\n여자가 하는 말의 주제로 가장 적절한 것은?\n(10 seconds)\n17번\n언급된 구조물이 아닌 것은?${separator}이제 듣기 문제가 끝났습니다. 18번부터는 문제지의 지시에 따라 답을 하시기 바랍니다.\n(10 seconds)\n18번 다음 글을 읽고 답하시오.\nM: Next passage.`);
    assert.equal(q.prompt, '다음을 듣고, 물음에 답하시오.');
    assert.deepEqual(q.subquestions, [
      { id: '16', prompt: '여자가 하는 말의 주제로 가장 적절한 것은?', endPause: 10 },
      { id: '17', prompt: '언급된 구조물이 아닌 것은?', endPause: 10 },
    ]);
    assert.equal(q.repeat, 2);
    assert.equal(q.endPause, 20);
    assert.deepEqual(q.turns, [{ speaker: 'W', text: 'Welcome, students.' }]);
    assert.equal(next.id, '18');
  }
});
test('running answer-sheet headers do not suppress dialogue continuing on the next page', () => {
  const questions = parseScript('정답 및 해설\n8. [출제의도] 정보\nW: This sounds great.\n1\n정답 및 해설\nW: That makes it even better.\nM: Then let us book it now.');
  assert.deepEqual(questions[0].turns, [
    { speaker: 'W', text: 'This sounds great.' },
    { speaker: 'W', text: 'That makes it even better.' },
    { speaker: 'M', text: 'Then let us book it now.' },
  ]);
});
test('answer-sheet grids are silent and a bare shared-passage heading starts its own repeated passage', () => {
  const grid = '1 ⑤\n2 ②\n3 ① 4 ④ 5 ⑤';
  assert.deepEqual(parseScript(grid), []);
  const questions = parseScript(`${grid}\n1. [출제의도] 담화의 목적\nW: Welcome.\n15. [출제의도] 상황\nM: Please help.\nAnna:\n16~17 긴 담화 듣기\nW: Today we learn about buildings.\n16. [출제의도] 주제\n17. [출제의도] 세부 내용\n[읽기]\n18. [출제의도] 글의 목적\n[해석]\nThis translation must not be spoken.`);
  assert.deepEqual(questions.map(q => q.id), ['1', '15', '16–17']);
  assert.equal(questions[2].repeat, 2);
  assert.deepEqual(questions[1].turns, [{ speaker: 'M', text: 'Please help.' }]);
  assert.deepEqual(questions[2].turns, [{ speaker: 'W', text: 'Today we learn about buildings.' }]);
});
test('WAV has valid PCM header, clipping and exact silence between clips', () => {
  const samples = joinAudio([new Float32Array([-2, 0]), new Float32Array([2])], 0.5, 4);
  assert.deepEqual([...samples], [-2, 0, 0, 0, 2]);
  const wav = new DataView(encodeWav(samples, 4));
  assert.equal(wav.byteLength, 54); assert.equal(wav.getUint32(24, true), 4);
  assert.equal(wav.getUint32(40, true), 10);
  assert.equal(wav.getInt16(44, true), -32768); assert.equal(wav.getInt16(52, true), 32767);
  assert.equal(joinAudio([], 2).length, 0);
});
test('long monologues retain every word without overflowing voice model input', () => {
  const long = 'Welcome to our school book fair. ' + 'Please bring your favorite books with you '.repeat(80) + 'Thank you!';
  const chunks = splitSpeech(long);
  assert.ok(chunks.every(c => c.length <= 200));
  assert.equal(chunks.join(' '), long.trim());
  assert.throws(() => splitSpeech('x'.repeat(201)), /OCR/);
  assert.deepEqual(splitSpeech(''), []);
});
