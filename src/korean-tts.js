import { pipeline } from '@huggingface/transformers';

const MODEL = 'onnx-community/Supertonic-TTS-2-ONNX';
const REVISION = '68d4d9420d0e0e51d14656e1ec5c9b091490b49e';
let ready;

export async function speakKorean(text, progress) {
  if (!text.trim()) throw new Error('한국어 질문을 입력해 주세요.');
  if (!ready) {
    ready = Promise.all([
      pipeline('text-to-speech', MODEL, {
        revision: REVISION, device: 'wasm', dtype: 'fp32',
        progress_callback: progress,
      }),
      fetch(`https://huggingface.co/${MODEL}/resolve/${REVISION}/voices/F1.bin`)
        .then(response => {
          if (!response.ok) throw new Error('한국어 목소리를 내려받지 못했습니다. 다시 시도해 주세요.');
          return response.arrayBuffer();
        }).then(buffer => new Float32Array(buffer)),
    ]).catch(error => {
      ready = undefined;
      throw error;
    });
  }
  const [tts, speaker_embeddings] = await ready;
  return tts(`<ko>${text.replace(/[<>]/g, '')}</ko>`, {
    speaker_embeddings, num_inference_steps: 5, speed: 1.05,
  });
}
