const heading = /^(?:\[\s*)?(\d{1,2})(?:\s*번?\s*(?:[-~–∼]|과|및|&)\s*(\d{1,2}))?\s*(?:번(?!부터|까지)\s*[.．:：\])]?|[.．)\]:：])\s*(.*)$/;
const speaker = /^(M|W|F|Man|Woman|Male|Female|Boy|Girl|남|여|남자|여자)\s*[:：]\s*(.*)$/i;
const namedSpeaker = /^(Speaker\s*\d+|ANN|[A-Z]|(?:[A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?)(?:\s+[A-Z][a-z]+){0,2})\s*[:：]\s*(.*)$/;
const proseLabels = /^(?:Note|Tip|Example|Title|Date|Source|Url|URL|Email|Warning|Important|Summary|Subject|Chapter|Unit|Lesson|Answer)$/i;
const circled = '①②③④⑤';

export function parseScript(text) {
  const questions = [];
  let current;
  let translation = false;
  let role = 'W';
  const answerSheet = /정\s*답\s*및\s*해\s*설/.test(text);
  const lines = text.replace(/\r/g, '').replace(/([.!?\]])(?=(?:M|W)\s*[:：])/g, '$1\n').replace(/\s+(?=(?:M|W)\s*[:：])/g, '\n').split('\n');
  const names = new Map();
  const matchSpeaker = line => {
    const known = line.match(speaker);
    if (known || answerSheet) return known;
    const named = line.match(namedSpeaker);
    return named && !proseLabels.test(named[1]) ? named : null;
  };
  // Unnumbered prose can play paragraph by paragraph; dialogue stays together.
  const paragraphs = !answerSheet && !lines.some(line => matchSpeaker(line.trim()) || heading.test(line.trim()) || /^[①②③④⑤]/.test(line.trim()));
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const original = lines[lineIndex];
    let line = original.replace(/\s+/g, ' ').trim();
    // Closing exam announcements can share a PDF line with the last question.
    line = line.split(/(?:이제\s*듣기\s*문제가?\s*끝났|\d{1,2}\s*번부터는\s*문제지의?\s*지시에)/)[0].trim();
    if (!line) {
      if (paragraphs && !original.trim() && !translation && current?.turns.some(t => t.speaker)) current = undefined;
      continue;
    }
    if (/^\d{1,2}$/.test(line) && Number(line) >= 1 && Number(line) <= 45) {
      const next = lines.slice(lineIndex + 1, lineIndex + 16).map(l => l.trim()).filter(Boolean).slice(0, 5);
      const roleIndex = next.findIndex(l => matchSpeaker(l));
      const numberIndex = next.findIndex(l => /^\d{1,2}$/.test(l));
      const previousNumber = Number(current?.id.split('–').at(-1) || 0);
      // Skip answer icons between the number and dialogue, but not page footers
      // or the separate 16/17 answer explanations after a shared 16–17 passage.
      if (Number(line) > previousNumber && roleIndex >= 0 && (numberIndex < 0 || roleIndex < numberIndex)) line += '번';
    }
    if (/^(?:\d{1,2}\s*[①②③④⑤]\s*)+$/.test(line)) continue;
    if (!speaker.test(line) && /^[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*\s*[:：]$/.test(line)) continue;
    if (/^\d+(?:\s+\d+)?$/.test(line) || /^(?:Signal\s+[MW]\s+(?:Up|Down)\b|\d+번부터)/i.test(line)) continue;
    if (/^ANN\s*[:：]/i.test(line) && (answerSheet || /[가-힣]/.test(line))) continue;
    const title = line.match(heading) || line.match(/^(\d{1,2})\s*[-~–∼]\s*(\d{1,2})\s+(.+)$/);
    if (title && answerSheet && (Number(title[1]) < 1 || Number(title[1]) > 45)) continue;
    if (title) {
      const id = title[2] ? `${title[1]}–${title[2]}` : title[1];
      current = { id, prompt: '', turns: [], options: [], answer: null, endPause: 0, repeat: id.includes('–') ? 2 : 1, warnings: [] };
      questions.push(current);
      translation = false;
      role = 'W';
      line = title[3].trim();
      if (!line) continue;
    }
    if (!current) {
      if (answerSheet && !matchSpeaker(line)) continue;
      if (!matchSpeaker(line) && /[가-힣]/.test(line)) continue;
      current = { id: String(questions.length + 1), prompt: '', turns: [], options: [], answer: null, endPause: 0, repeat: 1, warnings: [] };
      questions.push(current);
    }
    const answer = line.match(/^(?:\[?정답\]?|Answer)\s*[:：]?\s*([①②③④⑤1-5])/i);
    if (answer) { current.answer = circled.includes(answer[1]) ? circled.indexOf(answer[1]) + 1 : Number(answer[1]); continue; }
    const section = line.replace(/[\s\[\]()【】•·※<>〈〉-]/g, '');
    if (/^(?:해석|해설|어휘|우리말|번역)/.test(section)) { translation = true; continue; }
    if (translation) continue;
    if (/다시\s*한\s*번\s*듣겠/.test(line)) { current.repeatAt = current.turns.length; continue; }
    if (/^[①②③④⑤]/.test(line)) { current.options.push(line); continue; }
    const turn = matchSpeaker(line);
    if (answerSheet && current.turns.some(t => t.speaker)) {
      const content = turn ? turn[2] : line;
      const korean = (content.match(/[가-힣]/g) || []).length;
      const english = (content.match(/[a-z]/gi) || []).length;
      if (turn && korean >= 3 && korean > english) { translation = true; continue; }
    }
    if (answerSheet && !turn && /^[A-Z0-9()|®© _-]{1,12}$/.test(line)) continue;
    if (turn) {
      if (speaker.test(line)) role = /^(W|F|Woman|Female|Girl|여|여자)$/i.test(turn[1]) ? 'W' : 'M';
      else {
        const name = turn[1].toLowerCase().replace(/\s+/g, ' ');
        if (!names.has(name)) names.set(name, names.size % 2 ? 'M' : 'W');
        role = names.get(name);
      }
      line = turn[2].trim();
    } else if (/[가-힣]/.test(line)) {
      if (current.turns.length) continue;
      current.prompt += `${current.prompt ? ' ' : ''}${line}`;
      continue;
    }
    const trailingWait = line.match(/^\(?\[?\s*(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|초)\s*[)\]]?$/i);
    if (trailingWait) { current.endPause += Math.min(60, Number(trailingWait[1])); continue; }
    for (const part of line.split(/(\[[^\]\n]{1,160}\]|\(\s*\d+(?:\.\d+)?\s*(?:seconds?|secs?|초)\s*\))/i)) {
      if (/^[[(]/.test(part)) {
        if (/chime|bell|차임|종소리/i.test(part)) current.turns.push({ type: 'chime', text: part, duration: 1.5 });
        else if (/pause|seconds?|secs?|초|잠시/i.test(part)) current.turns.push({ type: 'pause', text: part, duration: Math.min(60, Number(part.match(/\d+(?:\.\d+)?/)?.[0] || 0.8)) });
        else if (part.trim()) current.warnings.push(`${part} 효과음은 지원하지 않아 제외됩니다.`);
      } else if (/[a-zA-Z0-9]/.test(part)) {
        const previous = current.turns.at(-1);
        if (!turn && previous?.speaker === role) previous.text += ` ${part.trim()}`;
        else current.turns.push({ speaker: role, text: part.trim(), ...(turn && !speaker.test(`${turn[1]}:`) ? { label: turn[1] } : {}) });
      }
    }
  }
  const result = [];
  for (const q of questions) {
    if (!q.turns.some(t => t.speaker && /[a-zA-Z0-9]/.test(t.text))) {
      const previous = result.at(-1);
      if (previous?.id.split('–').includes(q.id)) {
        previous.endPause += q.endPause;
        if (q.prompt) (previous.subquestions ||= []).push({ id: q.id, prompt: q.prompt });
      }
      continue;
    }
    if (q.repeatAt) {
      const signature = turns => turns.filter(t => t.speaker).map(t => `${t.speaker}:${t.text}`).join(' ').replace(/\s+/g, ' ');
      if (signature(q.turns.slice(0, q.repeatAt)) === signature(q.turns.slice(q.repeatAt))) {
        q.turns = q.turns.slice(0, q.repeatAt); q.repeat = 2;
      }
    }
    delete q.repeatAt;
    result.push(q);
  }
  return result;
}

export function encodeWav(samples, sampleRate = 24000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, value * (value < 0 ? 32768 : 32767), true);
  });
  return buffer;
}

export function joinWav(blobs) {
  const bytes = blobs.reduce((sum, blob) => sum + blob.size - 44, 0);
  if (bytes > 0xffffffff - 36) throw new Error('WAV 파일이 너무 커요. 대본을 나눠 주세요.');
  const header = encodeWav(new Float32Array());
  const view = new DataView(header);
  view.setUint32(4, 36 + bytes, true);
  view.setUint32(40, bytes, true);
  return new Blob([header, ...blobs.map(blob => blob.slice(44))], { type: 'audio/wav' });
}

export function joinAudio(clips, gapSeconds, sampleRate = 24000) {
  const gap = Math.round(gapSeconds * sampleRate);
  const output = new Float32Array(clips.reduce((sum, c) => sum + c.length, 0) + Math.max(0, clips.length - 1) * gap);
  let cursor = 0;
  clips.forEach((clip, i) => { output.set(clip, cursor); cursor += clip.length + (i < clips.length - 1 ? gap : 0); });
  return output;
}

export function splitSpeech(text) {
  const chunks = [];
  let chunk = '';
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)) {
    const sentence = segment.trim().replace(/\s+/g, ' ');
    if (!sentence) continue;
    // Keep short sentences together to avoid a model inference for every sentence.
    if (sentence.length <= 200) {
      if (chunk && chunk.length + sentence.length + 1 > 200) { chunks.push(chunk); chunk = ''; }
      chunk += `${chunk ? ' ' : ''}${sentence}`;
      continue;
    }
    for (const word of sentence.split(' ')) {
      if (word.length > 200) throw new Error('지나치게 긴 단어가 있어요. OCR 결과의 띄어쓰기를 확인해 주세요.');
      if (chunk && chunk.length + word.length + 1 > 200) { chunks.push(chunk); chunk = ''; }
      chunk += `${chunk ? ' ' : ''}${word}`;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
