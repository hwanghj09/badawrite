import { KokoroTTS } from 'kokoro-js';
import { synthesize, SAMPLE_RATE } from './audio.js';
import { cacheSpeech } from './speech-cache.js';
import { encodeWav } from './script.js';
import { env } from '@huggingface/transformers';
import { chooseRuntime } from './tts-runtime.js';

let model;
let runtime;
const speak = cacheSpeech(async (text, voice) => {
  const audio = await model.generate(text, { voice, speed: 1 });
  if (audio.sampling_rate !== SAMPLE_RATE) throw new Error('지원하지 않는 음성 샘플레이트입니다.');
  return audio.audio;
});
self.onmessage = async ({ data }) => {
  try {
    if (!model) {
      runtime = await chooseRuntime({ gpu: self.navigator.gpu, isolated: self.crossOriginIsolated, cores: self.navigator.hardwareConcurrency, forceWasm: data.forceWasm });
      env.backends.onnx.wasm.numThreads = runtime.threads;
      const engine = runtime.device === 'webgpu' ? 'GPU 가속' : `CPU ${runtime.threads}코어`;
      self.postMessage({ type: 'status', message: `${engine} · 처음 한 번 음성 모델을 준비해요. 다운로드한 모델은 다음에도 재사용해요.` });
      model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: runtime.dtype, device: runtime.device,
        progress_callback: p => {
          if (p.status === 'progress' && p.total > 1000000) self.postMessage({ type: 'status', message: `음성 모델 준비 중 · ${Math.round(p.progress)}%` });
        },
      });
    }
    const { samples, markers } = await synthesize(data.questions, data, speak,
      message => self.postMessage({ type: 'status', message }),
      async ({ index, marker, samples }) => {
        if (data.skipPreviews?.includes(index)) return;
        const wav = encodeWav(samples);
        self.postMessage({ type: 'question', index, marker, wav }, [wav]);
        // Give the browser a task boundary to expose this question before the
        // next inference begins, even when speech is already in the cache.
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    const wav = encodeWav(samples);
    self.postMessage({ type: 'done', wav, markers }, [wav]);
  } catch (error) {
    self.postMessage({ type: 'error', retryWithWasm: runtime?.device === 'webgpu', message: error.message || '음성을 생성하지 못했습니다.' });
  }
};
