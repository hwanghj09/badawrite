export const SAMPLE = `1. 다음 대화를 듣고, 두 사람이 만날 장소를 고르시오.
W: Hey, Daniel. Are we still meeting at the library this afternoon?
M: Actually, the library is closed today. How about the cafe across from the park?
W: That sounds good. Shall we meet there at three?
M: Perfect. I'll bring my notes for our science project.
① 도서관
② 공원 건너편 카페
③ 과학실
④ 학교 정문
⑤ 서점
정답: ②

2. 다음 대화를 듣고, 여자가 지불할 금액을 고르시오.
M: Welcome to Green Garden. How can I help you?
W: I'd like two tickets for the workshop. How much are they?
M: They're twenty dollars each. Students get a five-dollar discount on each ticket.
W: Great. We're both students. Here are our student cards.
① 20달러
② 25달러
③ 30달러
④ 35달러
⑤ 40달러
정답: ③

3. 다음을 듣고, 남자가 하는 말의 목적으로 가장 적절한 것을 고르시오.
M: Hello, everyone. This is a reminder about our school book fair. It will take place in the gym this Friday, from ten in the morning until four in the afternoon. You can bring books you no longer need and exchange them with other students. Please write your name inside each book. We hope to see you there!
① 체육관 이용 수칙을 설명하려고
② 도서관 신간을 소개하려고
③ 도서 교환 행사를 안내하려고
④ 독후감 제출을 독려하려고
⑤ 체육대회 일정을 변경하려고
정답: ③`;

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
