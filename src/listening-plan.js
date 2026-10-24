import { questionPromptsFor, spokenQuestion } from './question-paper.js';

export function speechWork(question, lowMemory = false) {
  return Math.max(1, question.turns.reduce((n, turn) => n + (turn.speaker ? turn.text.length : 0), 0)
    + (lowMemory ? 0 : questionPromptsFor(question).reduce((n, prompt) => n + spokenQuestion(prompt).length, 0)));
}

// Approximate speaking rates only predict unheard passages. Completed WAV
// durations replace these estimates, including gaps, cues and repeated passages.
export function estimateQuestionDuration(question, settings = {}, index = 0, last = false) {
  const bell = settings.examAudio ? 2.2 : 1.5;
  const turns = settings.questionChime && question.turns[0]?.type === 'chime' ? question.turns.slice(1) : question.turns;
  let passage = 0;
  for (const [i, turn] of turns.entries()) {
    if (turn.type === 'chime') passage += settings.examAudio ? bell : turn.duration;
    else if (turn.type === 'pause') passage += turn.duration;
    else {
      if (i && turns[i - 1].speaker) passage += settings.turnGap || 0;
      passage += turn.text.length / 14;
    }
  }
  const prompts = questionPromptsFor(question).reduce((n, prompt) => n + spokenQuestion(prompt).length / 5.5 + 0.7, 0);
  return (index === 0 && settings.examAudio ? 11.3 : 0) + (settings.questionChime ? bell : 0) + prompts
    + passage * (settings.repeat || question.repeat === 2 ? 2 : 1)
    + (settings.repeat || question.repeat === 2 ? 3 : 0)
    + (question.endPause || (!last ? settings.questionGap || 0 : 0));
}

export function planListening({ items, samples = [], elapsed = 0, playbackRate = 1 }) {
  const speed = Math.max(0.1, playbackRate || 1);
  const totalSeconds = items.reduce((n, item) => n + item.duration / speed, 0);
  const pending = items.filter(item => !item.ready);
  if (!pending.length) return { totalSeconds, waitSeconds: 0, generationSeconds: 0, canStart: items.length > 0 };
  // Ignore first-inference warm-up once another measurement is available.
  const measured = samples.length > 1 ? samples.slice(1).slice(-3) : samples;
  if (!measured.length) return { totalSeconds, waitSeconds: null, generationSeconds: null, canStart: false };
  const rates = measured.map(sample => sample.seconds / Math.max(1, sample.work));
  // Use the slowest recent measurement, extra headroom and the time already
  // spent on the current question. A slow/stalled task cannot count down to zero.
  const rate = Math.max(...rates, Math.max(0, elapsed) / Math.max(1, pending[0].work)) * 1.3;
  let generation = 0, playable = 0, delay = 0;
  let firstPending = true;
  let contiguous = 0;
  for (const item of items) {
    if (!item.ready) {
      generation += rate * item.work;
      if (firstPending) { generation = Math.max(2, generation - elapsed); firstPending = false; }
      // Check every deadline, not just completion of the last question.
      delay = Math.max(delay, generation + 3 - playable);
    } else if (firstPending) contiguous++;
    playable += item.duration / speed * (item.ready ? 1 : 0.8);
  }
  return { totalSeconds, waitSeconds: Math.ceil(Math.max(0, delay)), generationSeconds: Math.ceil(generation), canStart: contiguous >= 2 && delay <= 0 };
}
