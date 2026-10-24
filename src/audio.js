import { splitSpeech } from './script.js';
import { questionPromptsFor, spokenQuestion } from './question-paper.js';

export const SAMPLE_RATE = 24000;
export const VOICES = { M: 'am_michael', W: 'af_heart' };

export function resampleAudio(samples, sourceRate, targetRate = SAMPLE_RATE) {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error('음성 샘플링 주파수가 올바르지 않습니다.');
  }
  if (!samples.length || sourceRate === targetRate) return samples;
  const result = new Float32Array(Math.max(1, Math.round(samples.length * targetRate / sourceRate)));
  for (let i = 0; i < result.length; i++) {
    const position = Math.min(i * sourceRate / targetRate, samples.length - 1);
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    result[i] = samples[left] + (samples[right] - samples[left]) * (position - left);
  }
  return result;
}

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

export async function synthesize(questions, settings, speak, progress = () => {}, onQuestion, speakKorean) {
  const clips = [];
  const markers = [];
  let length = 0;
  for (const [index, q] of questions.entries()) {
    const clipStart = clips.length;
    const sampleStart = length;
    const start = length / SAMPLE_RATE;
    if (index === 0 && settings.intro) {
      clips.push(settings.intro); length += settings.intro.length;
    }
    const prompts = questionPromptsFor(q);
    if (prompts.length && !speakKorean) throw new Error('한국어 질문 음성을 준비하지 못했습니다. 다시 생성해 주세요.');
    for (const { id, prompt } of prompts) {
      progress(`${id}번 · 한국어 질문 읽는 중`);
      const audio = await speakKorean(spokenQuestion({ id, prompt }));
      if (!(audio instanceof Float32Array) || !audio.length || audio.some(value => !Number.isFinite(value))) {
        const error = new Error('한국어 질문 음성이 비어 있거나 올바르지 않습니다. 다시 생성해 주세요.');
        error.korean = true;
        throw error;
      }
      clips.push(audio, Math.round(0.7 * SAMPLE_RATE));
      length += audio.length + Math.round(0.7 * SAMPLE_RATE);
    }
    const turns = [];
    for (let i = 0; i < q.turns.length; i++) {
      const turn = q.turns[i];
      progress(`${q.id}번 · ${i + 1}/${q.turns.length} 대사·지시 처리 중`);
      if (turn.type === 'chime') turns.push(settings.chime || chime(turn.duration));
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
      if (settings.streamOnly) clips.length = 0;
    }
  }
  // Allocate the final track once; silence and repeated passages need no temporary PCM copies.
  return { samples: settings.streamOnly ? undefined : assemble(clips, length), markers };
}
