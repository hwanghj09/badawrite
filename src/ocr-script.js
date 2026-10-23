// Scanned answer books often lose their small section labels and question numbers.
// In that format, English role labels and the following Korean translation delimit
// each listening passage more reliably than the OCR of the decorative headings.
export function listeningFromOcr(text) {
  if (!/정\s*답\s*및\s*해\s*설/.test(text)) return text;
  const questions = [];
  let current;
  let number, numberAge = 99, range;
  const lines = text.replace(/\r/g, '').replace(/(^|\n)\s*([MW])\s*\n\s*[:：]\s*/gi, '$1$2: ').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    numberAge++;
    const compact = line.replace(/[\s\[\]()【】•·※<>〈〉-]/g, '');
    if (compact === '정답및해설') continue;
    const shared = line.match(/^[[(]?\s*(\d{1,2})\s*[-~–∼]\s*(\d{1,2})\s*[\])]?$/);
    if (shared) { current = undefined; range = [Number(shared[1]), Number(shared[2])]; continue; }
    if (/^\d{1,2}$/.test(line)) { number = Number(line); numberAge = 0; continue; }
    if (/^(?:해석|해설|어휘|우리말|번역)/.test(compact)) { current = undefined; continue; }
    const role = line.match(/^(M|W)\s*[:：]\s*(.*)$/i);
    const content = role ? role[2] : line;
    const korean = (content.match(/[가-힣]/g) || []).length;
    if (korean >= 3) { current = undefined; continue; }
    if (role && /[a-z]/i.test(content)) {
      if (!current) {
        let id = questions.length ? Number(questions.at(-1).id.split('–').at(-1)) + 1 : 1;
        if (numberAge < 6 && number >= id && number <= 45) id = number;
        if (range && range[1] === 17 && id === 16 && (range[0] === 6 || range[0] === 16)) range[0] = 16;
        const sharedId = range && range[0] === id && range[1] > id && range[1] - id <= 2;
        current = { id: sharedId ? `${id}–${range[1]}` : String(id), lines: [] };
        questions.push(current); range = undefined;
      }
      current.lines.push(`${role[1].toUpperCase()}: ${content}`);
    } else if (current) {
      if (/^[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*)*\s*[:：]/.test(line)) { current = undefined; continue; }
      if (/[®©]|^[A-Z0-9()[\]| _-]{1,12}$/.test(line)) continue;
      const upper = (line.match(/[A-Z]/g) || []).length;
      const lower = (line.match(/[a-z]/g) || []).length;
      if (upper >= 8 && upper >= lower * 2) continue;
      if (/[a-z]/i.test(line)) current.lines.push(line);
    }
  }
  // A regular scan without a recognizable listening section keeps its raw text.
  if (!questions.length) return text;
  return questions.map(q => `${q.id.replace('–', '~')}번\n${q.lines.join('\n')}`).join('\n\n');
}
