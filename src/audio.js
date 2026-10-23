import { splitSpeech } from './script.js';

export const SAMPLE_RATE = 24000;
export const VOICES = { M: 'am_michael', W: 'af_heart' };

export function chime(duration = 1.5) {
  const audio = new Float32Array(Math.round(duration * SAMPLE_RATE));
  for (let i = 0; i < audio.length; i++) {
    const t = i / SAMPLE_RATE;
    audio[i] = 0.18 * Math.sin(2 * Math.PI * 880 * t) * Math.exp(-5 * t)
      + (t >= 0.45 ? 0.18 * Math.sin(2 * Math.PI * 659.25 * (t - 0.45)) * Math.exp(-5 * (t - 0.45)) : 0);
  }
  return audio;
}

function assemble(clips, length) {
  const samples = new Float32Array(length);
  let offset = 0;
  for (const clip of clips) {
    if (typeof clip === 'number') offset += clip;
    else { samples.set(clip, offset); offset += clip.length; }
  }
  return samples;
}

export async function synthesize(questions, settings, speak, progress = () => {}, onQuestion) {
  const clips = [];
  const markers = [];
  let length = 0;
  for (const [index, q] of questions.entries()) {
    const clipStart = clips.length;
    const sampleStart = length;
    const turns = [];
    for (let i = 0; i < q.turns.length; i++) {
      const turn = q.turns[i];
      progress(`${q.id}번 · ${i + 1}/${q.turns.length} 대사·지시 처리 중`);
      if (turn.type === 'chime') turns.push(chime(turn.duration));
      else if (turn.type === 'pause') turns.push(Math.round(turn.duration * SAMPLE_RATE));
      else {
        if (i > 0 && q.turns[i - 1].speaker) turns.push(Math.round(settings.turnGap * SAMPLE_RATE));
        let first = true;
        for (const text of splitSpeech(turn.text)) {
          if (!first) turns.push(Math.round(0.08 * SAMPLE_RATE));
          turns.push(await speak(text, VOICES[turn.speaker]));
          first = false;
        }
      }
    }
    const start = length / SAMPLE_RATE;
    const passageLength = turns.reduce((sum, clip) => sum + (typeof clip === 'number' ? clip : clip.length), 0);
    for (const clip of turns) clips.push(clip);
    length += passageLength;
    if (settings.repeat || q.repeat === 2) {
      clips.push(3 * SAMPLE_RATE);
      for (const clip of turns) clips.push(clip);
      length += 3 * SAMPLE_RATE + passageLength;
    }
    markers.push({ id: q.id, start, end: length / SAMPLE_RATE });
    const gap = q.endPause || (q !== questions.at(-1) ? settings.questionGap : 0);
    const silence = Math.round(gap * SAMPLE_RATE);
    clips.push(silence); length += silence;
    if (onQuestion) {
      await onQuestion({ index, marker: markers.at(-1), samples: assemble(clips.slice(clipStart), length - sampleStart) });
    }
  }
  // Allocate the final track once; silence and repeated passages need no temporary PCM copies.
  return { samples: assemble(clips, length), markers };
}
