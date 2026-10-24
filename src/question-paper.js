import { correctQuestionPrompt } from './question-corrections.js';

const heading = /^(?:\[\s*)?(\d{1,2})(?:\s*번?\s*(?:[-~–∼]|과|및|&)\s*(\d{1,2}))?\s*(?:번(?!부터|까지)\s*[.．:：\])]?|[.,．)\]:：])\s*(.*)$/;
const rangeHeading = /^(\d{1,2})\s*[-~–∼]\s*(\d{1,2})\s+(.+)$/;
const choice = /[①②③④⑤]/;
const metadata = /(?:^(?:\[?정답(?:\]|[:：①②③④⑤1-5]|및해설|$)|\[?(?:해설|출제의도|해석|어휘|번역))|학년도|학력평가|모의평가|모의고사.*문제지|수학능력시험|^제\d+교시|^영어영역|^\d+쪽|^페이지|^이문제지.*(?:무단|재배포)|^이제듣기|^방송을잘|^따라답을|^\d{1,2}번(?:부터|까지)|^(?:홀수형|짝수형)$)/;
const isMetadata = text => metadata.test(text.replace(/\s+/g, ''));
const cleanPrompt = text => correctQuestionPrompt(String(text || '')
  .replace(/\[\s*\d*\s*점\s*\]|\(\s*\d+\s*점\s*\)/g, '')
  .replace(/\s+/g, ' ').trim()
  .replace(/(고르시오|답하시오)\s*[,，]$/, '$1.'));
const complete = text => /[?？.!。]$|(?:고르시오|답하시오|선택하시오)[,，]?$/.test(text.replace(/\s/g, ''));
const noisyChoice = /^(?:[©®@⓵⓶⓷⓸⓹]|\(?[1-5]\)|[[(]?\s*[①②③④⑤])/;
const spokenPrompt = text => {
  const prompt = cleanPrompt(text);
  return /[가-힣]/.test(prompt) && !isMetadata(prompt) ? prompt : '';
};

export function parseQuestionPaper(text) {
  const questions = [];
  let current;
  let stopped = false;
  for (const raw of String(text || '').replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10)).split(/\r?\n/)) {
    let line = raw.replace(/[～〜]/g, '~').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    // OCR can turn "1." into "L" or insert a dot before "10.". Only
    // recover the number when a recognisable question follows it.
    line = line.replace(/^[.·]\s*(?=\d{1,2}[.,])/, '')
      .replace(/^[ILl][.,]?\s+(?=(?:다음|대화))/, '1. ');
    if (isMetadata(line)) { stopped = true; continue; }
    const title = line.match(heading) || line.match(rangeHeading);
    if (title) {
      const first = Number(title[1]);
      const last = title[2] ? Number(title[2]) : first;
      if (first === 1 && last === 17) { current = undefined; continue; }
      if (first < 1 || last > 45 || last < first) { current = undefined; continue; }
      current = { id: title[2] ? `${first}–${last}` : String(first), prompt: '', options: [] };
      questions.push(current);
      stopped = false;
      line = title[3].trim();
    }
    if (!current || !line || /^(?:\d+(?:\s+\d+)?|\d+\s*[/／]\s*\d+|-\s*\d+\s*-)$/.test(line)) continue;
    if (isMetadata(line)) { stopped = true; continue; }
    if (stopped) continue;
    const choiceIndex = line.search(choice);
    const prompt = cleanPrompt(choiceIndex < 0 ? line : line.slice(0, choiceIndex));
    if (noisyChoice.test(line) && choiceIndex < 0) { stopped = true; continue; }
    if (!current.options.length && !complete(current.prompt) && /[가-힣]/.test(prompt)) {
      current.prompt = cleanPrompt(`${current.prompt ? `${current.prompt} ` : ''}${prompt}`);
    }
    if (choiceIndex >= 0) {
      current.options.push(...line.slice(choiceIndex).split(/(?=[①②③④⑤])/).map(option => option.trim()).filter(Boolean));
    } else if (current.options.length) {
      current.options[current.options.length - 1] += ` ${line}`;
    }
  }
  return questions.filter(question => question.prompt);
}

// Uploaded question papers are prompt-only: no choices, reading passages,
// page furniture or the exam-wide announcement enter the editable prompt box.
export function questionPaperText(text) {
  const byId = new Map();
  for (const { id, prompt } of parseQuestionPaper(text)) {
    if (Number(id.split('–').at(-1)) > 17) continue;
    // Stop at the question's instruction even if OCR adds a score or table
    // on the same line. Never let an answer-list item overwrite a real stem.
    const stem = prompt.match(/^.*?(?:고\s*르\s*시\s*오|답\s*하\s*시\s*오|선택하시오)[.,，。]?/)?.[0] || prompt;
    if (!/시오[.,，。]?$|[?？]$/.test(stem.replace(/\s/g, ''))) continue;
    if (!byId.has(id)) byId.set(id, { id, prompt: cleanPrompt(stem) });
  }
  return [...byId.values()]
    .sort((a, b) => Number(a.id.split('–')[0]) - Number(b.id.split('–')[0]) || b.id.length - a.id.length)
    .map(({ id, prompt }) => `${id.includes('–') ? `[${id}]` : `${id}.`} ${prompt}`)
    .join('\n');
}

export function questionPromptsFor(question) {
  const prompts = question.questionPrompts || [];
  return prompts.map(({ id, prompt }) => ({ id, prompt: spokenPrompt(prompt) })).filter(({ prompt }) => prompt);
}

function questionNumberReading(digits) {
  const number = Number(digits);
  if (!Number.isInteger(number) || number < 1 || number > 9999) return digits;
  const names = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const units = ['', '십', '백', '천'];
  return [...String(number)].reverse().map((digit, place) => {
    if (digit === '0') return '';
    return `${digit === '1' && place > 0 ? '' : names[Number(digit)]}${units[place]}`;
  }).reverse().join('');
}

export function spokenQuestion({ id, prompt }) {
  // Spell question ordinals explicitly: a TTS engine may read "10번" as
  // the frequency "열 번". Keep numeric IDs in the editor and markers.
  const label = String(id).replace(/(\d+)\s*[–~\-∼]\s*(\d+)/, '$1번과 $2').replace(/\d+/g, questionNumberReading);
  return `${label}번. ${cleanPrompt(prompt)}`;
}

export function attachQuestionPaper(questions, paper) {
  const byId = new Map(paper.map(question => [question.id, question]));
  return questions.map(question => {
    const copy = { ...question };
    const matched = byId.get(question.id);
    const range = question.id.match(/^(\d+)–(\d+)$/);
    if (range) {
      const subquestions = [];
      for (let id = Number(range[1]); id <= Number(range[2]); id++) {
        const subquestion = byId.get(String(id));
        const timing = question.subquestions?.find(q => q.id === String(id));
        if (subquestion) subquestions.push({ ...subquestion, ...(timing?.endPause ? { endPause: timing.endPause } : {}), options: [...subquestion.options] });
      }
      if (matched) copy.prompt = matched.prompt;
      if (subquestions.length) copy.subquestions = [...new Map([...(question.subquestions || []), ...subquestions].map(q => [q.id, q])).values()]
        .sort((a, b) => Number(a.id) - Number(b.id));
      if (matched || subquestions.length) {
        copy.questionPrompts = questionPromptsFor({ questionPrompts: [{ id: copy.id, prompt: copy.prompt }, ...(copy.subquestions || [])] });
      }
    } else if (matched) {
      copy.prompt = matched.prompt;
      copy.options = [...matched.options];
      copy.questionPrompts = [{ id: matched.id, prompt: matched.prompt }];
    }
    return copy;
  });
}
