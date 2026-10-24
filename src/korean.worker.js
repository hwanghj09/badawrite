import { speakKorean } from './korean-tts.js';
import { resampleAudio } from './audio.js';
import { splitSpeech, joinAudio } from './script.js';
import { env } from '@huggingface/transformers';

env.backends.onnx.wasm.numThreads = 1;

// This worker is terminated before the English model starts on memory-limited
// devices. Disposing a session alone does not release a worker's WASM heap.
self.onmessage = async ({ data: { prompts } }) => {
  try {
    const clips = [];
    for (const [index, text] of prompts.entries()) {
      self.postMessage({ type: 'status', message: `한국어 질문 ${index + 1}/${prompts.length}개 준비 중` });
      const parts = [];
      for (const chunk of splitSpeech(text)) {
        const result = await speakKorean(chunk, p => {
          if (p.status === 'progress' && p.total > 1000000) self.postMessage({ type: 'status', message: `한국어 음성 모델 준비 중 · ${Math.round(p.progress)}%` });
        });
        parts.push(resampleAudio(result.audio, result.sampling_rate));
      }
      const samples = joinAudio(parts, 0.08);
      if (!samples.length || samples.some(value => !Number.isFinite(value))) throw new Error('한국어 질문 음성이 올바르지 않습니다.');
      clips.push({ text, samples });
    }
    self.postMessage({ type: 'done', clips }, clips.map(clip => clip.samples.buffer));
  } catch (error) {
    self.postMessage({ type: 'error', message: `한국어 질문 음성 생성 실패: ${error.message || '모델을 준비하지 못했습니다.'}` });
  }
};
