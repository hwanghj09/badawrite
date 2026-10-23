import { KokoroTTS } from 'kokoro-js';
import { joinAudio, splitSpeech } from './script.js';

let model;
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
    const total = data.questions.reduce((sum, q) => sum + q.turns.length, 0);
    let completed = 0;
    const clips = [];
    const markers = [];
    let elapsed = 0;
    for (const q of data.questions) {
      const turns = [];
      for (const turn of q.turns) {
        self.postMessage({ type: 'status', message: `${q.id}번 음성 만드는 중 · ${++completed} / ${total} 대사` });
        const sentences = [];
        // Kokoro truncates long inputs; split before synthesis so no dialogue disappears.
        for (const text of splitSpeech(turn.text)) {
          const audio = await model.generate(text, { voice: turn.speaker === 'M' ? 'am_michael' : 'af_heart', speed: 1 });
          if (audio.sampling_rate !== 24000) throw new Error('지원하지 않는 음성 샘플레이트입니다.');
          sentences.push(audio.audio);
        }
        turns.push(joinAudio(sentences, 0.08));
      }
      const passage = joinAudio(turns, data.turnGap);
      const repeated = data.repeat ? joinAudio([passage, passage], 3) : passage;
      markers.push({ id: q.id, start: elapsed, end: elapsed + repeated.length / 24000 });
      clips.push(repeated);
      elapsed += repeated.length / 24000 + data.questionGap;
    }
    const samples = joinAudio(clips, data.questionGap);
    self.postMessage({ type: 'done', samples, markers }, [samples.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || '음성을 생성하지 못했습니다.' });
  }
};
