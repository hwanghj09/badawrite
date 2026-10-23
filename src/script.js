const heading = /^(?:\[\s*)?(\d{1,2})(?:\s*[-~–∼]\s*(\d{1,2}))?\s*(?:번\s*[.．:：\])]?|[.．)\]:：])\s*(.*)$/;
const speaker = /^(M|W|F|Man|Woman|Male|Female|Boy|Girl|남|여|남자|여자)\s*[:：]\s*(.*)$/i;
const circled = '①②③④⑤';

export function parseScript(text) {
  const questions = [];
  let current;
  let translation = false;
  for (const original of text.replace(/\r/g, '').split('\n')) {
    const line = original.trim();
    if (!line) continue;
    const title = line.match(heading);
    if (title) {
      const id = title[2] ? `${title[1]}–${title[2]}` : title[1];
      current = { id, prompt: title[3].trim(), turns: [], options: [], answer: null };
      questions.push(current);
      translation = false;
      continue;
    }
    if (!current) {
      current = { id: '1', prompt: '', turns: [], options: [], answer: null };
      questions.push(current);
    }
    const answer = line.match(/^(?:\[?정답\]?|Answer)\s*[:：]?\s*([①②③④⑤1-5])/i);
    if (answer) { current.answer = circled.includes(answer[1]) ? circled.indexOf(answer[1]) + 1 : Number(answer[1]); continue; }
    if (/^(?:\[?(?:해석|해설|어휘|우리말|번역)\]?)/.test(line)) { translation = true; continue; }
    if (translation) continue;
    if (/^[①②③④⑤]/.test(line)) { current.options.push(line); continue; }
    const turn = line.match(speaker);
    if (turn) {
      current.turns.push({ speaker: /^(W|F|Woman|Female|Girl|여|여자)$/i.test(turn[1]) ? 'W' : 'M', text: turn[2].trim() });
    } else if (/[a-zA-Z]{2}/.test(line) && !/[가-힣]/.test(line)) {
      if (current.turns.length) current.turns.at(-1).text += ` ${line}`;
      else current.turns.push({ speaker: 'W', text: line });
    } else if (!current.turns.length && /[가-힣]/.test(line)) {
      current.prompt += `${current.prompt ? ' ' : ''}${line}`;
    }
  }
  return questions.filter(q => q.turns.some(t => /[a-zA-Z]/.test(t.text)));
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

export function joinAudio(clips, gapSeconds, sampleRate = 24000) {
  const gap = Math.round(gapSeconds * sampleRate);
  const output = new Float32Array(clips.reduce((sum, c) => sum + c.length, 0) + Math.max(0, clips.length - 1) * gap);
  let cursor = 0;
  clips.forEach((clip, i) => { output.set(clip, cursor); cursor += clip.length + (i < clips.length - 1 ? gap : 0); });
  return output;
}

export function splitSpeech(text) {
  const chunks = [];
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)) {
    let chunk = '';
    for (const word of segment.trim().split(/\s+/)) {
      if (word.length > 200) throw new Error('지나치게 긴 단어가 있어요. OCR 결과의 띄어쓰기를 확인해 주세요.');
      if (chunk && chunk.length + word.length + 1 > 200) { chunks.push(chunk); chunk = ''; }
      chunk += `${chunk ? ' ' : ''}${word}`;
    }
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}
