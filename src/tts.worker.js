import { KokoroTTS } from 'kokoro-js';
import { synthesize, resampleAudio, SAMPLE_RATE } from './audio.js';
import { cacheSpeech } from './speech-cache.js';
import { encodeWav, splitSpeech, joinAudio } from './script.js';
import { speakKorean } from './korean-tts.js';
import { env } from '@huggingface/transformers';
import { chooseRuntime } from './tts-runtime.js';
import { loadExamAudio } from './exam-audio.js';

let model;
let runtime;
const speak = cacheSpeech(async (text, voice) => {
  const audio = await model.generate(text, { voice, speed: 1 });
  if (audio.sampling_rate !== SAMPLE_RATE) throw new Error('지원하지 않는 음성 샘플레이트입니다.');
  return audio.audio;
});
const koreanSpeech = cacheSpeech(async text => {
  try {
    const clips = [];
    for (const chunk of splitSpeech(text)) {
      const audio = await speakKorean(chunk, p => {
        if (p.status === 'progress' && p.total > 1000000) self.postMessage({ type: 'status', message: `한국어 음성 모델 준비 중 · ${Math.round(p.progress)}%` });
      });
      clips.push(resampleAudio(audio.audio, audio.sampling_rate));
    }
    return joinAudio(clips, 0.08);
  } catch (cause) {
    const error = new Error(`한국어 질문 음성 생성 실패: ${cause.message || '모델을 준비하지 못했습니다.'}`);
    error.korean = true;
    throw error;
  }
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
    self.postMessage({ type: 'inference' });
    const examAudio = data.examAudio ? await loadExamAudio() : {};
    const { markers } = await synthesize(data.questions, { ...data, ...examAudio, streamOnly: true }, speak,
      message => self.postMessage({ type: 'status', message }),
      async ({ index, marker, samples }) => {
        self.postMessage({ type: 'progress', index });
        if (data.skipPreviews?.includes(index)) return;
        const wav = encodeWav(samples);
        self.postMessage({ type: 'question', index, marker, wav }, [wav]);
        // Give the browser a task boundary to expose this question before the
        // next inference begins, even when speech is already in the cache.
        await new Promise(resolve => setTimeout(resolve, 0));
      }, koreanSpeech);
    self.postMessage({ type: 'done', markers });
  } catch (error) {
    self.postMessage({ type: 'error', retryWithWasm: !error.korean && runtime?.device === 'webgpu', message: error.message || '음성을 생성하지 못했습니다.' });
  }
};
