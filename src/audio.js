import { joinAudio, splitSpeech } from './script.js';

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

export async function synthesize(questions, settings, speak, progress = () => {}) {
  const clips = [];
  const markers = [];
  let elapsed = 0;
  for (const q of questions) {
    const turns = [];
    for (let i = 0; i < q.turns.length; i++) {
      const turn = q.turns[i];
      progress(`${q.id}번 · ${i + 1}/${q.turns.length} 대사·지시 처리 중`);
      if (turn.type === 'chime') turns.push(chime(turn.duration));
      else if (turn.type === 'pause') turns.push(new Float32Array(Math.round(turn.duration * SAMPLE_RATE)));
      else {
        const sentences = [];
        for (const text of splitSpeech(turn.text)) sentences.push(await speak(text, VOICES[turn.speaker]));
        if (i > 0 && q.turns[i - 1].speaker) turns.push(new Float32Array(Math.round(settings.turnGap * SAMPLE_RATE)));
        turns.push(joinAudio(sentences, 0.08));
      }
    }
    const passage = joinAudio(turns, 0);
    const repeated = settings.repeat || q.repeat === 2 ? joinAudio([passage, passage], 3) : passage;
    markers.push({ id: q.id, start: elapsed, end: elapsed + repeated.length / SAMPLE_RATE });
    const gap = q.endPause || (q !== questions.at(-1) ? settings.questionGap : 0);
    clips.push(repeated, new Float32Array(Math.round(gap * SAMPLE_RATE)));
    elapsed += repeated.length / SAMPLE_RATE + gap;
  }
  return { samples: joinAudio(clips, 0), markers };
}
