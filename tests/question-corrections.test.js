import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { correctQuestionPrompt } from '../src/question-corrections.js';
import { parseQuestionPaper, questionPaperText, attachQuestionPaper } from '../src/question-paper.js';
import { parseScript } from '../src/script.js';
import { synthesize } from '../src/audio.js';

const observed = [
  // Explicit user examples.
  ['적절핫', '적절한'], ['저절한', '적절한'],
  ['가장저절한것을 고르시오.', '가장적절한것을 고르시오.'],
  // Actual OCR outputs at different sizes/language orders/layout modes.
  ['여자의 의견으로 가장 저청한 것을 고르시오.', '여자의 의견으로 가장 적절한 것을 고르시오.'],
  ['여자의 의견으로 가장 정청한 것을 고르시오.', '여자의 의견으로 가장 적절한 것을 고르시오.'],
  ['남자가 하는 맡의 목적으로 기장 적절한 것을 고르시오.', '남자가 하는 말의 목적으로 가장 적절한 것을 고르시오.'],
  ['남자가 하는 말의 요기로 기장 적절한 것을 고르시오.', '남자가 하는 말의 요지로 가장 적절한 것을 고르시오.'],
  ['남자가 하는 말의 유지로 가장 적절한 것을 고르시오.', '남자가 하는 말의 요지로 가장 적절한 것을 고르시오.'],
  ['남지가 하는 말의 목적으로 가장 적절할 것을 고르시오.', '남자가 하는 말의 목적으로 가장 적절한 것을 고르시오.'],
  ['여자의 의건으로 가장 저청한 것을 고르시오.', '여자의 의견으로 가장 적절한 것을 고르시오.'],
  ['가장 ART 것을 고르시오.', '가장 적절한 것을 고르시오.'],
  ['가장 GEA 것을 고르시오.', '가장 적절한 것을 고르시오.'],
  ['기장 AAR 것을 고르시오.', '가장 적절한 것을 고르시오.'],
  ['남자가 하는 말의 주제로 가장 적정한 것은?', '남자가 하는 말의 주제로 가장 적절한 것은?'],
  ['남자가 하는 말의 주제로 가장 적절찬 것은?', '남자가 하는 말의 주제로 가장 적절한 것은?'],
  ['여자의 옹답으로 가장 적절한 것을 고르시오.', '여자의 응답으로 가장 적절한 것을 고르시오.'],
  ['여자의 옹담으로 가장 적절한 것을 고르시오.', '여자의 응답으로 가장 적절한 것을 고르시오.'],
  ['여자의 응담으로 가장 적절한 것을 고르시오.', '여자의 응답으로 가장 적절한 것을 고르시오.'],
  ['일치하지 않는 것을 르시오,', '일치하지 않는 것을 고르시오,'],
  ['다음을 듣고, S80 답하시오.', '다음을 듣고, 물음에 답하시오.'],
  // Multiple observed errors in the same stem must settle in a single pass.
  ['남지가 하는 맡의 목적으로 기장 저절한 것을 고르시오.', '남자가 하는 말의 목적으로 가장 적절한 것을 고르시오.'],
];

test('user examples and observed scan errors are corrected consistently and idempotently', () => {
  for (const [input, expected] of observed) {
    assert.equal(correctQuestionPrompt(input), expected, input);
    assert.equal(correctQuestionPrompt(expected), expected);
  }
});

test('correct words, negation, numbers and names are preserved rather than guessed', () => {
  for (const input of [
    '일치하지 않는 것을 고르시오.', '언급되지 않은 것을 고르시오.', '언급된 동물이 아닌 것은?',
    '적절하지 않은 응답을 고르시오.', '가장 적절한 것을 고르시오.',
    '남지 않는 것을 고르시오.', '언급된 동물이 아넌 것은?',
    '적정한 가격을 고르시오.', '가장 적정한 것은?', '가장 적정한 것을 고르시오.', '미래에 가장 적절할 것으로 보이는 것은?',
    '기장의 마지막 말에 대한 응답으로 적절한 것은?',
    'Ms. Jones가 Andrew에게 할 말로 가장 적절한 것을 고르시오.',
    'Outdoor Gear Expo에 관해 언급되지 않은 것은?',
    '가장 50 것을 고르시오.', '50달러, 550달러, 15번과 17번',
    '저절한 씨의 의견으로 가장 적절한 것은?', 'ART Gallery에 관한 것은?',
  ]) assert.equal(correctQuestionPrompt(input), input);
});

test('wrapped question wording is corrected after joining lines without changing choices', () => {
  const [q] = parseQuestionPaper('1. 남자의 마지막 말에 대한 여자의 옹답으로 가장\n적정한 것을 고르시오.\n① 저절한\n② 50달러');
  assert.equal(q.prompt, '남자의 마지막 말에 대한 여자의 응답으로 가장 적절한 것을 고르시오.');
  assert.deepEqual(q.options, ['① 저절한', '② 50달러']);
});

for (const file of ['diarchive01-ocr.txt', 'diarchive01-ipad-ocr.txt']) {
  test(`real paper fixture ${file} corrects common stems while retaining unresolved names and negation`, async () => {
    const raw = await readFile(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
    const paper = parseQuestionPaper(questionPaperText(raw));
    assert.equal(paper.find(q => q.id === '2').prompt, '대화를 듣고, 여자의 의견으로 가장 적절한 것을 고르시오.');
    assert.match(paper.find(q => q.id === '13').prompt, /여자의 응답으로 가장 적절한/);
    assert.equal(paper.find(q => q.id === '16').prompt, '남자가 하는 말의 주제로 가장 적절한 것은?');
    assert.match(paper.find(q => q.id === '8').prompt, /언급되지 않은/);
    assert.match(paper.find(q => q.id === '9').prompt, /일치하지 않는/);
  });
}

test('the corrected prompt reaches Korean speech while English dialogue and question labels stay intact', async () => {
  const [q] = attachQuestionPaper(parseScript('1. M: This is the original English dialogue.'), parseQuestionPaper('1. 가장 적절핫 것을 고르시오.'));
  const korean = [], english = [];
  await synthesize([q], { turnGap: 0, questionGap: 0 }, async text => { english.push(text); return new Float32Array([0.25]); },
    undefined, undefined, async text => { korean.push(text); return new Float32Array([0.5]); });
  assert.deepEqual(korean, ['일번. 가장 적절한 것을 고르시오.']);
  assert.deepEqual(english, ['This is the original English dialogue.']);
});
