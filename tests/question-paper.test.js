import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/script.js';
import { parseQuestionPaper, attachQuestionPaper, questionPromptsFor } from '../src/question-paper.js';

test('extracts wrapped numbered Korean questions and choices without scores or answers', () => {
  const paper = parseQuestionPaper('2026학년도 영어 영역\n1. 다음을 듣고, 남자가 하는 말의\n목적으로 가장 적절한 것을 고르시오. [3점]\n① 사과하려고 ② 초대하려고\n③ 감사하려고\n정답: ②\n해설은 읽지 않습니다.\n２번 다음 중 적절하지 않은 것은?\n① A\n② B\n1 8');
  assert.deepEqual(paper, [
    { id: '1', prompt: '다음을 듣고, 남자가 하는 말의 목적으로 가장 적절한 것을 고르시오.', options: ['① 사과하려고', '② 초대하려고', '③ 감사하려고'] },
    { id: '2', prompt: '다음 중 적절하지 않은 것은?', options: ['① A', '② B'] },
  ]);
});

test('links by number without changing original dialogue, audio or answers', () => {
  const questions = parseScript('1. 기존 질문입니다.\nW: Hello.\n2. 두 번째 질문입니다.\nM: Goodbye.');
  questions[0].audio = new Float32Array([0.25]);
  questions[0].answer = 2;
  const original = structuredClone(questions);
  const paper = parseQuestionPaper('2. 알맞은 응답을 고르시오.\n① Thanks.\n② Sorry.\n1. 말의 목적으로 적절한 것은?\n① 인사');
  const attached = attachQuestionPaper(questions, paper);
  assert.deepEqual(attached[0].questionPrompts, [{ id: '1', prompt: '말의 목적으로 적절한 것은?' }]);
  assert.deepEqual(attached[1].options, ['① Thanks.', '② Sorry.']);
  assert.equal(attached[0].answer, 2);
  assert.equal(attached[0].audio, questions[0].audio);
  assert.deepEqual(questions, original);
  assert.notEqual(attached[0], questions[0]);
  assert.notEqual(attached[0].options, paper[1].options);
});

test('shared 16–17 passage receives common instruction and both numbered prompts once', () => {
  const [question] = parseScript('[16~17] 다음을 듣고 답하시오.\nW: Welcome to our school.');
  const paper = parseQuestionPaper('[16~17] 다음을 듣고, 물음에 답하시오.\n16. 말의 주제로 가장 적절한 것은?\n① 학교 ② 여행\n17번 언급되지 않은 것은? [2점]\n① 기차 ② 버스');
  const [attached] = attachQuestionPaper([question], paper);
  assert.deepEqual(questionPromptsFor(attached), [
    { id: '16–17', prompt: '다음을 듣고, 물음에 답하시오.' },
    { id: '16', prompt: '말의 주제로 가장 적절한 것은?' },
    { id: '17', prompt: '언급되지 않은 것은?' },
  ]);
  assert.equal(attached.repeat, 2);
  assert.deepEqual(attached.subquestions[1].options, ['① 기차', '② 버스']);
  assert.equal(attached.turns, question.turns);
});

test('empty or unrelated paper leaves inline prompts silent and metadata stays silent', () => {
  const questions = parseScript('3. 적절한 응답을 고르시오.\nW: Hello.');
  assert.deepEqual(parseQuestionPaper(''), []);
  assert.deepEqual(parseQuestionPaper('영어 영역\n① 선택지\n정답 및 해설\n0. 잘못된 번호\n46. 잘못된 번호'), []);
  assert.deepEqual(questionPromptsFor(attachQuestionPaper(questions, [])[0]), []);
  assert.equal(attachQuestionPaper(questions, parseQuestionPaper('8. 다른 문항은?'))[0].prompt, questions[0].prompt);
  assert.deepEqual(questionPromptsFor({ id: '1', prompt: '[출제의도] 목적', subquestions: [] }), []);
  assert.deepEqual(questionPromptsFor({ questionPrompts: [{ id: '1', prompt: '[출제의도] 목적' }] }), []);
  assert.deepEqual(questionPromptsFor({ id: '1', prompt: 'An English heading', questionPrompts: [] }), []);
});

test('exam-wide introduction, reading questions and page footers do not enter matching listening prompts', () => {
  const paper = parseQuestionPaper('[1~17] 다음은 듣고 답하는 문제입니다.\n1. 다음을 듣고, 남자가 하는 말의 목적으로 가장 적절한 것을\n고르시오. [2점]\n① 초대하려고\n[16~17]\n다음을 듣고 물음에 답하시오.\n16. 말의 주제로 적절한 것은?\n① 여행\n17. 언급되지 않은 것은？ [3점]\n① 기차\n2 / 8\n- 2 -\n영 어 영 역\n18. 다음 글의 목적으로 적절한 것은?\nThis notice is about a meeting.\n① 알림');
  const questions = parseScript('1번\nW: Hello.\n[16~17] 다음을 듣고 물음에 답하시오.\nW: Welcome.');
  const attached = attachQuestionPaper(questions, paper);
  assert.deepEqual(questionPromptsFor(attached[0]), [{ id: '1', prompt: '다음을 듣고, 남자가 하는 말의 목적으로 가장 적절한 것을 고르시오.' }]);
  assert.deepEqual(questionPromptsFor(attached[1]), [
    { id: '16–17', prompt: '다음을 듣고 물음에 답하시오.' },
    { id: '16', prompt: '말의 주제로 적절한 것은?' },
    { id: '17', prompt: '언급되지 않은 것은？' },
  ]);
  assert.deepEqual(attached[1].subquestions[1].options, ['① 기차']);
  assert.equal(attached.length, 2);
});

test('question wording can mention answers or explanations while answer-key labels remain silent', () => {
  const paper = parseQuestionPaper('1. 다음 중 정답을 고르시오.\n① Yes.\n[정답] ③\n해설은 읽지 않습니다.\n2. 정답을 고르시오.\n정답: 3\n3. 다음 해설을 듣고 알맞은 것을 고르시오.\n정답 ③\n4. 다음을 듣고 정답을\n고르시오.\n정 답 및 해 설\nThis is not a question.');
  assert.deepEqual(paper.map(({ prompt }) => prompt), [
    '다음 중 정답을 고르시오.', '정답을 고르시오.', '다음 해설을 듣고 알맞은 것을 고르시오.', '다음을 듣고 정답을 고르시오.',
  ]);
  assert.deepEqual(questionPromptsFor({ questionPrompts: paper }), paper.map(({ id, prompt }) => ({ id, prompt })));
  for (const prompt of ['[정답] ③', '정답: 3', '정답 ③', '해설: 듣기 설명', '[해설] 듣기 설명']) {
    assert.deepEqual(questionPromptsFor({ questionPrompts: [{ id: '1', prompt }] }), []);
  }
});
