import { SAMPLE_RATE } from './audio.js';

let ready;
export function loadExamAudio({ signal } = {}) {
  if (!ready) ready = Promise.all(['intro', 'chime'].map(async name => {
    const response = await fetch(`${import.meta.env?.BASE_URL || '/'}audio/csat-${name}.wav`, { signal });
    if (!response.ok) throw new Error('수능 안내방송·차임벨을 불러오지 못했어요. 다시 시도해 주세요.');
    const buffer = await response.arrayBuffer();
    const view = new DataView(buffer);
    if (buffer.byteLength < 44 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645
      || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== SAMPLE_RATE
      || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== buffer.byteLength - 44 || (buffer.byteLength - 44) % 2) {
      throw new Error('수능 음원 파일이 올바르지 않아요. 새로고침 후 다시 시도해 주세요.');
    }
    return Float32Array.from({ length: (buffer.byteLength - 44) / 2 }, (_, i) => view.getInt16(44 + i * 2, true) / 32768);
  })).then(([intro, chime]) => ({ intro, chime })).catch(error => { ready = undefined; throw error; });
  return ready;
}
