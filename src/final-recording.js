import { encodeWav, joinWav, joinWavPcm } from './script.js';
import { chime, SAMPLE_RATE } from './audio.js';
import { loadExamAudio } from './exam-audio.js';

const bytesPerSecond = SAMPLE_RATE * 2;
const pcm = samples => new Blob([encodeWav(samples)]).slice(44);

async function startsWith(blob, offset, expected) {
  if (!expected || blob.size < 44 + offset + expected.byteLength) return false;
  const actual = new Int16Array(await blob.slice(44 + offset, 44 + offset + expected.byteLength).arrayBuffer());
  // Older writers can round positive PCM one step differently.
  return actual.every((value, i) => Math.abs(value - expected[i]) <= 1);
}

export async function finalizeRecording(previews, questions, settings = {}, signal) {
  signal?.throwIfAborted();
  if (!questions.length || previews.length !== questions.length || previews.some(part => !part)) throw new Error('완성되지 않은 문항이 있어 저장할 수 없어요. 다시 생성해 주세요.');
  const includeIntro = settings.examAudio !== false;
  const includeChime = settings.questionChime !== false;
  const assets = includeIntro ? await loadExamAudio({ signal }) : {};
  const intro = includeIntro ? pcm(assets.intro) : undefined;
  const bell = includeChime ? pcm(assets.chime || chime()) : undefined;
  const introSamples = intro ? new Int16Array(await intro.arrayBuffer()) : undefined;
  const bellSamples = bell ? new Int16Array(await bell.arrayBuffer()) : undefined;
  const parts = [], markers = [], durations = [];
  let cursor = 0, repaired = 0;
  for (const [index, part] of previews.entries()) {
    signal?.throwIfAborted();
    const header = new DataView(await part.slice(0, 44).arrayBuffer());
    if (part.size < 44 || header.getUint32(0) !== 0x52494646 || header.getUint32(8) !== 0x57415645
      || header.getUint16(20, true) !== 1 || header.getUint16(22, true) !== 1 || header.getUint32(24, true) !== SAMPLE_RATE
      || header.getUint16(34, true) !== 16 || header.getUint32(40, true) !== part.size - 44 || (part.size - 44) % 2) {
      throw new Error('문항 WAV가 올바르지 않아 저장할 수 없어요. 다시 생성해 주세요.');
    }
    const requiredIntro = index === 0 ? intro : undefined;
    const hasIntro = requiredIntro && await startsWith(part, 0, introSamples);
    const offset = hasIntro ? requiredIntro.size : 0;
    const hasBell = bell && await startsWith(part, offset, bellSamples);
    let complete = part;
    if ((requiredIntro && !hasIntro) || (bell && !hasBell)) {
      const chunks = [];
      if (requiredIntro) chunks.push(hasIntro ? part.slice(44, 44 + offset) : requiredIntro);
      if (bell) chunks.push(hasBell ? part.slice(44 + offset, 44 + offset + bell.size) : bell);
      chunks.push(part.slice(44 + offset + (hasBell ? bell.size : 0)));
      complete = joinWavPcm(chunks);
      repaired++;
    }
    const duration = (complete.size - 44) / bytesPerSecond;
    const gap = questions[index].endPause || (index < questions.length - 1 ? settings.questionGap || 0 : 0);
    markers.push({ id: questions[index].id, start: cursor, end: cursor + Math.max(0, duration - gap) });
    cursor += duration; durations.push(duration); parts.push(complete);
  }
  return { blob: joinWav(parts), markers, durations, cues: { intro: includeIntro, chime: includeChime }, repaired };
}
