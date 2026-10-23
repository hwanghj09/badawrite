import { KokoroTTS } from 'kokoro-js';
import { synthesize, SAMPLE_RATE } from './audio.js';
import { cacheSpeech } from './speech-cache.js';
import { encodeWav } from './script.js';

let model;
const speak = cacheSpeech(async (text, voice) => {
  const audio = await model.generate(text, { voice, speed: 1 });
  if (audio.sampling_rate !== SAMPLE_RATE) throw new Error('지원하지 않는 음성 샘플레이트입니다.');
  return audio.audio;
});
self.onmessage = async ({ data }) => {
  try {
    if (!model) {
      self.postMessage({ type: 'status', message: '처음 한 번, 영어 음성 모델을 내려받아요. 기기와 네트워크에 따라 몇 분 걸릴 수 있어요.' });
      model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8', device: 'wasm',
        progress_callback: p => {
          if (p.status === 'progress' && p.total > 1000000) self.postMessage({ type: 'status', message: `음성 모델 준비 중 · ${Math.round(p.progress)}%` });
        },
      });
    }
    const { samples, markers } = await synthesize(data.questions, data, speak,
      message => self.postMessage({ type: 'status', message }),
      ({ index, marker, samples }) => {
        const wav = encodeWav(samples);
        self.postMessage({ type: 'question', index, marker, wav }, [wav]);
      });
    const wav = encodeWav(samples);
    self.postMessage({ type: 'done', wav, markers }, [wav]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || '음성을 생성하지 못했습니다.' });
  }
};
