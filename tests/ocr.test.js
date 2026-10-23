import test from 'node:test';
import assert from 'node:assert/strict';
import { readingRegions } from '../src/ocr-layout.js';
import { listeningFromOcr } from '../src/ocr-script.js';
import { parseScript } from '../src/script.js';

test('a long central divider is read left column first, without splitting ordinary text strokes', () => {
  const width = 200, height = 400;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const dark = (x, y) => data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  for (let y = 45; y < 350; y++) dark(100, y);
  const regions = readingRegions({ width, height, data });
  assert.equal(regions.length, 2);
  assert(regions[0].left + regions[0].width < 100);
  assert(regions[1].left > 100);
  data.fill(255);
  for (let row = 50; row < 350; row += 30) for (let y = row; y < row + 12; y++) dark(100, y);
  assert.deepEqual(readingRegions({ width, height, data }), [{ left: 0, top: 0, width, height }]);
});

test('scanned answer books recover missing headings and exclude translations, cues and OCR caption noise', () => {
  const text = '정답 및 해설\nNOISY TABLE\n1\n®\nM: Welcome to our school.\nA second English line.\n1\n남: 우리 학교에 오신 것을 환영합니다.\n문항 해설입니다.\nlibrary 도서관\nGID\nW: What time is it?\nM: It is noon.\ni SE ER SR rata RE Re i SEE CA\nMs. Jones: __________\n여: 지금 몇 시인가요?\n3\n정답 ①\nW: Goodbye.';
  const questions = parseScript(listeningFromOcr(text));
  assert.deepEqual(questions.map(q => q.id), ['1', '2', '3']);
  assert.deepEqual(questions[0].turns, [{ speaker: 'M', text: 'Welcome to our school. A second English line.' }]);
  assert.deepEqual(questions[1].turns, [{ speaker: 'W', text: 'What time is it?' }, { speaker: 'M', text: 'It is noon.' }]);
  assert.equal(questions[2].turns[0].text, 'Goodbye.');
});

test('a scanned final 16–17 passage repeats twice even if OCR loses the first digit of its heading', () => {
  const earlier = Array.from({ length: 15 }, (_, i) => `${i + 1}\nM: Message number ${i + 1}.\n남: 한글 해석입니다.`).join('\n');
  const text = `정답 및 해설\n${earlier}\n[6~17]\nW: Learn about nature.\n여: 자연에 대해 배워요.\n16\n정답 ③\n한글 해설입니다.\n17\n정답 ②\napply 적용하다`;
  const questions = parseScript(listeningFromOcr(text));
  assert.deepEqual(questions.map(q => q.id), [...Array.from({ length: 15 }, (_, i) => String(i + 1)), '16–17']);
  assert.equal(questions.at(-1).repeat, 2);
  assert.deepEqual(questions.at(-1).turns, [{ speaker: 'W', text: 'Learn about nature.' }]);
});

test('plain OCR scripts are preserved, and visible question numbers are not silently closed up', () => {
  const plain = '1번\nW: Hello.\n[Chime bell rings.]';
  assert.equal(listeningFromOcr(plain), plain);
  const text = '정답 및 해설\n1\nW: First.\n여: 첫 문항입니다.\n3\nM: Third.';
  assert.deepEqual(parseScript(listeningFromOcr(text)).map(q => q.id), ['1', '3']);
});
