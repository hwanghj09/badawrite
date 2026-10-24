import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseQuestionPaper, questionPaperText, attachQuestionPaper } from '../src/question-paper.js';
import { questionSpeechTexts } from '../src/listening-sequence.js';
import { parseScript } from '../src/script.js';
import { synthesize } from '../src/audio.js';

const ids = [...Array.from({ length: 15 }, (_, i) => String(i + 1)), '16–17', '16', '17'];
for (const name of ['diarchive01-ocr.txt', 'diarchive01-ipad-ocr.txt']) {
  test(`actual scanned paper (${name}) retains 17 stems and shared instruction, excluding choices, headers and reading text`, async () => {
    const raw = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    const cleaned = questionPaperText(raw);
    const questions = parseQuestionPaper(cleaned);
    assert.deepEqual(questions.map(q => q.id), ids);
    assert.ok(questions.every(q => !q.options.length));
    assert.doesNotMatch(cleaned, /무단|재배포|번부터|한 번만|Tour Packages|\$|①|©|컴퓨터 관련 직원|소비자 스스로|18\.|\[3점\]|33\]/);
    assert.match(questions.find(q => q.id === '9').prompt, /World Ice Art/);
    assert.match(questions.find(q => q.id === '9').prompt, /일치하지 않는/);
    assert.match(questions.find(q => q.id === '8').prompt, /언급되지 않은/);
    assert.equal(questionPaperText(cleaned), cleaned);
  });
}

test('exam announcement cannot create question 1 or 15; complete stems survive damaged choice markers', () => {
  const cleaned = questionPaperText('1번부터 17번까지는 듣고 답하는 문제입니다.\n15번까지는 한 번만 들려주고\nL 다음을 듣고, 알맞은 것을 고르시오\n© 선택지입니다.\n@ 다른 선택지입니다.\n. 10. 다음 표를 보면서 대화를 듣고,\n알맞은 것을 고르시오, 33]\nTour Packages\n0 스 x\n이 문제지에 대한 무단 전재 및 재배포를 금지합니다.');
  assert.equal(cleaned, '1. 다음을 듣고, 알맞은 것을 고르시오\n10. 다음 표를 보면서 대화를 듣고, 알맞은 것을 고르시오.');
  assert.equal(questionPaperText('2026학년도\n① 보기\n8]\n이 문제지에 대한 무단전재 및 재배포를 금지합니다.'), '');
});

test('verified source prompts are read once, common instruction once, intro once and 16–17 English twice', async () => {
  const paper = await readFile(new URL('./fixtures/diarchive01-prompts.txt', import.meta.url), 'utf8');
  const script = [...Array.from({ length: 15 }, (_, i) => `${i + 1}번\nW: Message ${i + 1}.`), '[16~17]\nM: Shared passage.'].join('\n');
  const questions = attachQuestionPaper(parseScript(script), parseQuestionPaper(questionPaperText(paper)));
  const korean = [], english = [];
  const result = await synthesize(questions, { turnGap: 0, questionGap: 0, intro: new Float32Array([0.75]) },
    async text => { english.push(text); return new Float32Array([0.25]); }, undefined, undefined,
    async text => { korean.push(text); return new Float32Array([0.5]); });
  assert.deepEqual(korean, questions.flatMap(questionSpeechTexts));
  assert.equal(korean.length, 20);
  assert.equal(korean.filter(text => text.startsWith('십육번부터 십칠번까지는 두 번')).length, 1);
  assert.equal(korean.filter(text => text === '다시 한 번 듣겠습니다.').length, 1);
  assert.equal(korean.at(-1), '십칠번. 언급된 동물이 아닌 것은?');
  assert.equal(english.length, 16);
  assert.equal([...result.samples].filter(sample => sample === 0.75).length, 1);
  assert.equal([...result.samples].filter(sample => sample === 0.25).length, 17);
});
