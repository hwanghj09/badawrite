const heading = /^(?:\[\s*)?(\d{1,2})(?:\s*번?\s*(?:[-~–∼]|과|및|&)\s*(\d{1,2}))?\s*(?:번\s*[.．:：\])]?|[.．)\]:：])\s*(.*)$/;
const rangeHeading = /^(\d{1,2})\s*[-~–∼]\s*(\d{1,2})\s+(.+)$/;
const choice = /[①②③④⑤]/;
const metadata = /(?:^(?:\[?정답(?:\]|[:：①②③④⑤1-5]|및해설|$)|\[?(?:해설|출제의도|해석|어휘|번역))|학년도|학력평가|모의평가|수학능력시험|^제\d+교시|^영어영역|^\d+쪽|^페이지)/;
const isMetadata = text => metadata.test(text.replace(/\s+/g, ''));
const cleanPrompt = text => String(text || '').replace(/\[\s*\d+\s*점\s*\]|\(\s*\d+\s*점\s*\)/g, '').replace(/\s+/g, ' ').trim();
const spokenPrompt = text => {
  const prompt = cleanPrompt(text);
  return /[가-힣]/.test(prompt) && !isMetadata(prompt) ? prompt : '';
};

export function parseQuestionPaper(text) {
  const questions = [];
  let current;
  let stopped = false;
  for (const raw of String(text || '').replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10)).split(/\r?\n/)) {
    let line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const title = line.match(heading) || line.match(rangeHeading);
    if (title) {
      const first = Number(title[1]);
      const last = title[2] ? Number(title[2]) : first;
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
    if (!current.options.length && !/[?？.!。]$/.test(current.prompt) && /[가-힣]/.test(prompt)) {
      current.prompt += `${current.prompt ? ' ' : ''}${prompt}`;
    }
    if (choiceIndex >= 0) {
      current.options.push(...line.slice(choiceIndex).split(/(?=[①②③④⑤])/).map(option => option.trim()).filter(Boolean));
    } else if (current.options.length) {
      current.options[current.options.length - 1] += ` ${line}`;
    }
  }
  return questions.filter(question => question.prompt);
}

export function questionPromptsFor(question) {
  const prompts = question.questionPrompts || [];
  return prompts.map(({ id, prompt }) => ({ id, prompt: spokenPrompt(prompt) })).filter(({ prompt }) => prompt);
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
        if (subquestion) subquestions.push({ ...subquestion, options: [...subquestion.options] });
      }
      if (matched) copy.prompt = matched.prompt;
      if (subquestions.length) copy.subquestions = subquestions;
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
