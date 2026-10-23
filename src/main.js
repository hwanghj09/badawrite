import './style.css';
import { parseScript, SAMPLE, encodeWav } from './script.js';

const $ = id => document.getElementById(id);
const audio = $('audio');
let questions = [];
let selected = 0;
let worker;
let busy = false;
let audioUrl;
let markers = [];
const answers = new Map();
const previewUrls = [];

function showStatus(message, error = false) {
  $('status').hidden = false;
  $('status').classList.toggle('error', error);
  $('status').textContent = message;
}
function tab(name) {
  ['image', 'text'].forEach(type => {
    const active = type === name;
    $(`${type}-pane`).hidden = !active;
    $(`${type}-tab`).classList.toggle('selected', active);
    $(`${type}-tab`).setAttribute('aria-selected', String(active));
  });
}
$('image-tab').onclick = () => tab('image');
$('text-tab').onclick = () => tab('text');
for (const name of ['image', 'text']) $(`${name}-tab`).onkeydown = event => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    const next = name === 'image' ? 'text' : 'image';
    tab(next); $(`${next}-tab`).focus();
  }
};
function lock(value) {
  busy = value;
  for (const id of ['script', 'file-input', 'sample', 'clear', 'turn-gap', 'question-gap', 'repeat']) $(id).disabled = value;
  $('generate').disabled = value || !questions.length;
}
function invalidateAudio() {
  audio.pause(); audio.removeAttribute('src'); audio.load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null; markers = [];
  $('play').disabled = true; $('download').disabled = true; $('seek').disabled = true;
  $('seek').value = 0; $('time').textContent = '00:00 / 00:00';
  $('player-caption').textContent = '설정한 대본으로 음성을 만들면 재생할 수 있어요';
  $('track-title').textContent = '나만의 듣기 파일';
}
function updateScript() {
  invalidateAudio();
  questions = parseScript($('script').value);
  selected = 0; answers.clear();
  $('char-count').textContent = `${$('script').value.length.toLocaleString()}자`;
  $('question-count').textContent = questions.length ? `${questions.length}개 지문 인식` : '대본을 기다리고 있어요';
  $('empty-practice').hidden = questions.length > 0;
  $('exercise').hidden = questions.length === 0;
  $('generate').disabled = !questions.length || busy;
  renderQuestions();
  if (questions.length) renderExercise();
  document.querySelectorAll('.step')[1].classList.toggle('current', questions.length > 0);
  document.querySelectorAll('.step')[2].classList.remove('current');
}
function renderQuestions() {
  $('question-list').replaceChildren(...questions.map((q, i) => {
    const button = document.createElement('button');
    button.className = `question-button${i === selected ? ' selected' : ''}`;
    button.textContent = `${q.id}번`;
    button.setAttribute('aria-pressed', String(i === selected));
    button.onclick = () => {
      selected = i; $('show-script').checked = false;
      if (markers[i]) audio.currentTime = markers[i].start;
      renderQuestions(); renderExercise();
    };
    return button;
  }));
}
function renderExercise() {
  const q = questions[selected];
  if (!q) return;
  $('exercise-number').textContent = `QUESTION ${q.id.padStart(2, '0')}`;
  $('exercise-prompt').textContent = q.prompt || '대본을 듣고 가지고 있는 문제를 풀어보세요.';
  $('transcript').hidden = !$('show-script').checked;
  $('transcript').replaceChildren(...q.turns.map(turn => {
    const line = document.createElement('p');
    const label = document.createElement('b'); label.textContent = turn.speaker;
    const text = document.createElement('span'); text.textContent = turn.text;
    line.append(label, text); return line;
  }));
  const answer = answers.get(q.id);
  $('options').replaceChildren(...q.options.map(option => {
    const number = '①②③④⑤'.indexOf(option[0]) + 1;
    const button = document.createElement('button');
    button.className = `option-button${answer === number ? ' selected' : ''}${answer && q.answer === number ? ' correct' : ''}`;
    button.textContent = option;
    button.setAttribute('aria-pressed', String(answer === number));
    button.onclick = () => { answers.set(q.id, number); renderExercise(); };
    return button;
  }));
  $('answer-feedback').textContent = answer
    ? q.answer ? answer === q.answer ? '정답이에요. 잘 들었어요!' : `다시 들어볼까요? 대본의 정답은 ${'①②③④⑤'[q.answer - 1]}번이에요.`
      : '답을 기록했어요. 정답이 포함되지 않아 채점하지 않았어요.'
    : q.options.length ? '음성을 듣고 답을 골라보세요. 정답이 대본에 있을 때만 채점해요.'
      : '선택지가 없는 대본이에요. 가지고 있는 문제지에서 풀어보세요.';
}
$('show-script').onchange = renderExercise;
$('script').oninput = updateScript;
$('clear').onclick = () => { $('script').value = ''; updateScript(); $('status').hidden = true; };
$('sample').onclick = () => {
  if (busy) return;
  if ($('script').value.trim() && !window.confirm('현재 대본을 예시 대본으로 바꿀까요?')) return;
  $('script').value = SAMPLE; tab('text'); updateScript();
  showStatus('직접 만든 연습용 예시 3문항이에요. 실제 기출문제가 아닙니다. ‘듣기 파일 만들기’를 눌러 시작해 보세요.');
};
for (const id of ['turn-gap', 'question-gap', 'repeat']) $(id).onchange = invalidateAudio;

async function importFiles(files) {
  if (busy || !files.length) return;
  if (files.length > 10) return showStatus('사진은 한 번에 10장까지 가져올 수 있어요.', true);
  if (files.some(f => f.size > 10 * 1024 * 1024)) return showStatus('파일당 10MB 이하로 올려주세요.', true);
  if (files.some(f => !['image/jpeg', 'image/png', 'image/webp', 'text/plain'].includes(f.type) && !/\.txt$/i.test(f.name))) return showStatus('JPG, PNG, WEBP 사진 또는 TXT 파일을 선택해 주세요. PDF는 대본 부분을 사진으로 저장해 올려주세요.', true);
  lock(true);
  let ocr;
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let text;
      if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) text = await file.text();
      else {
        showStatus(`${i + 1}/${files.length}장 · 글자를 읽을 준비 중이에요. 첫 실행에는 인식 모델을 내려받아요.`);
        if (!ocr) {
          const { createWorker } = await import('tesseract.js');
          ocr = await createWorker('eng+kor', 1, {
            logger: p => { if (p.status === 'recognizing text') showStatus(`${i + 1}/${files.length}장 · 글자 인식 ${Math.round(p.progress * 100)}%`); },
          });
        }
        const result = await ocr.recognize(file);
        text = result.data.text;
      }
      if (!text.trim()) throw new Error(`${file.name}에서 글자를 찾지 못했어요. 대본 부분을 더 크게 찍어주세요.`);
      $('script').value += `${$('script').value.trim() ? '\n\n' : ''}${text.trim()}`;
      const preview = document.createElement('div'); preview.className = 'file-preview';
      if (file.type.startsWith('image/')) {
        const image = document.createElement('img'); image.src = URL.createObjectURL(file); image.alt = ''; previewUrls.push(image.src); preview.append(image);
      }
      const name = document.createElement('span'); name.textContent = file.name; preview.append(name); $('file-previews').append(preview);
    }
    tab('text'); updateScript();
    showStatus('대본을 가져왔어요. 문항 번호, M: / W: 화자와 영어 대사를 확인하고 수정해 주세요. 해석·해설은 음성에 포함되지 않아요.');
  } catch (error) {
    tab('text'); updateScript();
    showStatus(`${error.message} 이미 읽은 대본은 입력창에 남겨두었어요.`, true);
  } finally {
    if (ocr) await ocr.terminate().catch(() => {});
    lock(false); $('file-input').value = '';
  }
}
$('file-input').onchange = e => importFiles([...e.target.files]);
$('dropzone').ondragover = e => { e.preventDefault(); if (!busy) $('dropzone').classList.add('dragover'); };
$('dropzone').ondragleave = () => $('dropzone').classList.remove('dragover');
$('dropzone').ondrop = e => { e.preventDefault(); $('dropzone').classList.remove('dragover'); importFiles([...e.dataTransfer.files]); };
document.addEventListener('paste', e => {
  const images = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (images.length) { e.preventDefault(); importFiles(images); }
});

function stopGeneration(message, error = false) {
  worker?.terminate(); worker = undefined; lock(false); $('cancel').hidden = true;
  $('generate').innerHTML = '<span>✦</span> 듣기 파일 만들기 <span>→</span>';
  showStatus(message, error);
}
$('generate').onclick = () => {
  if (busy || !questions.length) return;
  const length = questions.reduce((sum, q) => sum + q.turns.reduce((n, t) => n + t.text.length, 0), 0);
  if (length > 25000) return showStatus('한 번에 영어 대사 25,000자까지 만들 수 있어요. 대본을 나눠서 생성해 주세요.', true);
  invalidateAudio(); lock(true); $('cancel').hidden = false;
  $('generate').textContent = '음성을 준비하고 있어요…';
  showStatus('음성 생성을 시작해요. 이 화면을 열어두세요.');
  if (!worker) {
    worker = new Worker(new URL('./tts.worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => stopGeneration('음성 엔진을 실행하지 못했어요. 최신 Chrome 또는 Edge에서 다시 시도해 주세요.', true);
    worker.onmessage = ({ data }) => {
      if (data.type === 'status') return showStatus(data.message);
      if (data.type === 'error') return stopGeneration(`음성 생성에 실패했어요: ${data.message} 네트워크 연결과 기기 메모리를 확인하고 다시 시도해 주세요.`, true);
      if (data.type !== 'done') return;
      markers = data.markers;
      audioUrl = URL.createObjectURL(new Blob([encodeWav(data.samples)], { type: 'audio/wav' }));
      audio.src = audioUrl; audio.playbackRate = Number($('speed').value);
      $('play').disabled = false; $('download').disabled = false; $('seek').disabled = false;
      $('track-title').textContent = `나의 영어 듣기 · ${questions.length}개 지문`;
      $('player-caption').textContent = '문항 번호를 누르면 해당 지문으로 이동해요';
      lock(false); $('cancel').hidden = true;
      $('generate').innerHTML = '<span>✦</span> 듣기 파일 다시 만들기 <span>→</span>';
      document.querySelectorAll('.step')[2].classList.add('current');
      showStatus('듣기 파일이 완성됐어요! 재생하거나 WAV로 저장해 언제든 연습해 보세요. 원본 시험과 다른 합성 음성입니다.');
    };
  }
  worker.postMessage({ questions, turnGap: Number($('turn-gap').value), questionGap: Number($('question-gap').value), repeat: $('repeat').checked });
};
$('cancel').onclick = () => stopGeneration('생성을 취소했어요. 대본은 그대로 남아 있어요.');
const time = seconds => `${Math.floor((seconds || 0) / 60).toString().padStart(2, '0')}:${Math.floor((seconds || 0) % 60).toString().padStart(2, '0')}`;
$('play').onclick = async () => {
  if (!audioUrl) return;
  if (!audio.paused) return audio.pause();
  try { await audio.play(); } catch { showStatus('재생을 시작하지 못했어요. 재생 버튼을 다시 눌러주세요.', true); }
};
audio.onplay = () => { $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', '일시정지'); };
audio.onpause = audio.onended = () => { $('play').textContent = '▶'; $('play').setAttribute('aria-label', '재생'); };
function updateTime() {
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  $('time').textContent = `${time(audio.currentTime)} / ${time(duration)}`;
  $('seek').max = duration || 100; $('seek').value = audio.currentTime || 0;
  const index = markers.findIndex(m => audio.currentTime >= m.start && audio.currentTime < m.end);
  if (index >= 0 && selected !== index) { selected = index; $('show-script').checked = false; renderQuestions(); renderExercise(); }
}
audio.ontimeupdate = audio.onloadedmetadata = updateTime;
$('seek').oninput = () => { audio.currentTime = Number($('seek').value); };
$('speed').onchange = () => { audio.playbackRate = Number($('speed').value); };
$('download').onclick = () => {
  if (!audioUrl) return;
  const link = document.createElement('a'); link.href = audioUrl; link.download = `bada-listening-${new Date().toISOString().slice(0, 10)}.wav`; link.click();
};
window.addEventListener('beforeunload', event => {
  if (busy || $('script').value.trim()) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', () => {
  worker?.terminate(); if (audioUrl) URL.revokeObjectURL(audioUrl); previewUrls.forEach(url => URL.revokeObjectURL(url));
});
