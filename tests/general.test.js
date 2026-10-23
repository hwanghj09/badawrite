import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/script.js';
import { synthesize, SAMPLE_RATE, VOICES } from '../src/audio.js';

const settings = { turnGap: 0, questionGap: 0, repeat: false };

test('unnumbered articles become playable paragraphs without dropping wrapped lines or repeating them', async () => {
  const questions = parseScript('The ocean covers most of our planet.\nIt is home to many animals.\n\nSome animals live near the surface.\nOthers live deep underwater.');
  assert.deepEqual(questions.map(q => q.id), ['1', '2']);
  assert.deepEqual(questions.map(q => q.turns[0].text), [
    'The ocean covers most of our planet. It is home to many animals.',
    'Some animals live near the surface. Others live deep underwater.',
  ]);
  let finishSecond;
  const gate = new Promise(resolve => { finishSecond = resolve; });
  const ready = [];
  const job = synthesize(questions, settings, async text => {
    if (text.startsWith('Some animals')) await gate;
    return new Float32Array(SAMPLE_RATE);
  }, () => {}, part => { ready.push(part.index); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ready, [0]);
  finishSecond();
  const result = await job;
  assert.deepEqual(ready, [0, 1]);
  assert.equal(result.samples.length, 2 * SAMPLE_RATE);
});

test('named classroom and interview speakers keep their voices and names out of generated speech', async () => {
  const questions = parseScript('1.\nAlice: Good morning.\nBob: How are you?\nAlice: Very well.\nThank you.\n\n2.\nBob: Let us begin.\nAlice: I am ready.');
  assert.deepEqual(questions.map(q => q.turns.map(t => t.label)), [['Alice', 'Bob', 'Alice'], ['Bob', 'Alice']]);
  assert.deepEqual(questions.map(q => q.turns.map(t => t.speaker)), [['W', 'M', 'W'], ['M', 'W']]);
  assert.equal(questions[0].turns[2].text, 'Very well. Thank you.');
  const spoken = [];
  await synthesize(questions, settings, async (text, voice) => { spoken.push({ text, voice }); return new Float32Array(1); });
  assert.equal(spoken[0].text, 'Good morning.');
  assert.equal(spoken[3].voice, VOICES.M);
  assert(!spoken.some(s => /Alice:|Bob:/.test(s.text)));
});

test('A/B, numbered speaker and classroom role dialogues work without exam headings', () => {
  for (const labels of [['A', 'B'], ['Speaker 1', 'Speaker 2'], ['Teacher', 'Student'], ['Host', 'Guest']]) {
    const [q] = parseScript(`${labels[0]}: Hello.\n\n${labels[1]}: Hi.\n${labels[0]}: Welcome back.`);
    assert.deepEqual(q.turns.map(t => t.speaker), ['W', 'M', 'W']);
    assert.deepEqual(q.turns.map(t => t.text), ['Hello.', 'Hi.', 'Welcome back.']);
    assert.equal(q.repeat, 1);
  }
});

test('ordinary colon text and URLs stay prose rather than being treated as speakers', () => {
  const [q] = parseScript('Note: Bring a pen.\nSource: https://example.com/story\nThe lesson begins at 10:30.');
  assert.equal(q.turns.length, 1);
  assert.equal(q.turns[0].text, 'Note: Bring a pen. Source: https://example.com/story The lesson begins at 10:30.');
});

test('general articles still exclude a following Korean translation', () => {
  const questions = parseScript('A short story.\n\nThe story continues.\n[해석]\n짧은 이야기입니다.\nEnglish vocabulary in the translation must be excluded.');
  assert.equal(questions.length, 2);
  assert.deepEqual(questions.map(q => q.turns[0].text), ['A short story.', 'The story continues.']);
});

test('a listening-script label does not force a general conversation into exam parsing', () => {
  const [q] = parseScript('영어 듣기 대본\nAlice: Hello.\nBob: Welcome back.');
  assert.deepEqual(q.turns.map(t => t.text), ['Hello.', 'Welcome back.']);
  assert.deepEqual(q.turns.map(t => t.label), ['Alice', 'Bob']);
});

test('general signal prose and English announcements are not removed as exam production cues', () => {
  assert.equal(parseScript('Signal processing is useful.')[0].turns[0].text, 'Signal processing is useful.');
  const [q] = parseScript('ANN: Welcome to the museum.\nOur doors open at nine.');
  assert.equal(q.turns[0].text, 'Welcome to the museum. Our doors open at nine.');
  assert.equal(q.turns[0].label, 'ANN');
});
