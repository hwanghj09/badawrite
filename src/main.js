import './style.css';
import './theme.js';
import { parseScript } from './script.js';
import { createFileReader } from './read-files.js';
import { outputNames } from './batch.js';

const $ = id => document.getElementById(id);
const audio = $('audio');
let sequence = 0;
const newDocument = name => ({ key: ++sequence, name: name || `직접입력 ${sequence}`, text: '', questions: [], answers: new Map(), state: '대본 입력 대기', output: null, previews: [] });
let documents = [newDocument()];
let active = documents[0];
let selected = 0;
let worker;
let rejectGeneration;
let operation;
let playback;
let listening = false;
let waiting;

function showStatus(message, error = false) {
  $('status').hidden = false;
  $('status').classList.toggle('error', error);
  $('status').textContent = message;
}
function tab(name) {
  for (const type of ['image', 'text']) {
    const current = type === name;
    $(`${type}-pane`).hidden = !current;
    $(`${type}-tab`).classList.toggle('selected', current);
    $(`${type}-tab`).setAttribute('aria-selected', String(current));
  }
}
$('image-tab').onclick = () => tab('image');
$('text-tab').onclick = () => tab('text');
for (const name of ['image', 'text']) $(`${name}-tab`).onkeydown = event => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    const next = name === 'image' ? 'text' : 'image'; tab(next); $(`${next}-tab`).focus();
  }
};
function refreshControls() {
  const busy = Boolean(operation);
  for (const id of ['script', 'file-input', 'clear', 'new-document', 'turn-gap', 'question-gap', 'repeat']) $(id).disabled = busy;
  const count = documents.filter(d => d.questions.length && !d.output).length;
  $('generate').disabled = busy || !count;
  if (!busy) {
    $('generate').textContent = !count && documents.some(d => d.output) ? '음성 생성 완료'
      : count > 1 ? `남은 ${count}개 파일 음성 만들기 →` : '듣기 만들기 →';
  }
  $('cancel').hidden = !busy;
  $('download-all').disabled = busy || !documents.some(d => d.output);
  renderDocuments();
}
function discardOutput(doc) {
  if (doc.output) URL.revokeObjectURL(doc.output.url);
  for (const preview of doc.previews) if (preview) URL.revokeObjectURL(preview.url);
  doc.output = null;
  doc.previews = [];
}
function renderDocuments() {
  $('batch-count').textContent = `${documents.length}개 파일 · ${documents.filter(d => d.output).length}개 완료`;
  $('document-list').replaceChildren(...documents.map(doc => {
    const row = document.createElement('div'); row.className = 'document-row';
    const button = document.createElement('button'); button.className = `document-select${doc === active ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(doc === active));
    const name = document.createElement('strong'); name.textContent = doc.name;
    const info = document.createElement('small'); info.textContent = doc.state;
    button.append(name, info); button.onclick = () => { listening = false; waiting = undefined; selectDocument(doc); };
    const save = document.createElement('button'); save.className = 'text-button'; save.textContent = 'WAV';
    save.disabled = !doc.output; save.setAttribute('aria-label', `${doc.name} WAV 저장`);
    save.onclick = () => download(doc.output.url, outputNames(documents)[documents.indexOf(doc)]);
    const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = '삭제';
    remove.disabled = Boolean(operation); remove.setAttribute('aria-label', `${doc.name} 삭제`);
    remove.onclick = () => {
      discardOutput(doc); documents = documents.filter(d => d !== doc);
      if (!documents.length) documents.push(newDocument());
      if (active === doc) selectDocument(documents[0]);
      refreshControls();
    };
    row.append(button, save, remove); return row;
  }));
}
function loadAudio() {
  audio.pause(); audio.removeAttribute('src'); audio.load();
  if (playback?.preview && !playback.doc.previews.some(p => p?.url === playback.url)) URL.revokeObjectURL(playback.url);
  playback = undefined;
  $('play').textContent = '▶'; $('play').setAttribute('aria-label', '재생');
  const output = active.output;
  const preview = active.previews[selected];
  const track = output || preview;
  $('practice').hidden = !track;
  if (track) {
    playback = { doc: active, url: track.url, preview: !output, index: selected };
    audio.src = track.url; audio.playbackRate = Number($('speed').value);
    if (output) audio.currentTime = output.markers[selected]?.start || 0;
  }
  for (const id of ['play', 'seek']) $(id).disabled = !track;
  $('download').disabled = !output;
  $('seek').value = 0; $('time').textContent = '00:00 / 00:00';
  updatePlayerCaption();
  document.querySelectorAll('.step')[2].classList.toggle('current', Boolean(track));
}
function updatePlayerCaption() {
  const ready = active.previews.filter(Boolean).length;
  const previewing = playback?.doc === active && playback.preview;
  $('track-title').textContent = previewing ? `${active.name} · ${active.questions[selected].id}번` : active.output ? active.name : '나만의 듣기 파일';
  $('player-caption').textContent = active.output ? previewing ? '전체 생성 완료 · 다른 문항도 선택해 들을 수 있어요' : '문항을 선택하면 해당 지문으로 이동해요'
    : ready ? `${ready}/${active.questions.length}개 문항 듣기 가능 · 완료된 문항부터 재생하세요` : '선택한 파일의 음성을 만들면 여기서 재생돼요';
}
function receiveQuestion(doc, data) {
  if (doc.previews[data.index]) URL.revokeObjectURL(doc.previews[data.index].url);
  const blob = new Blob([data.wav], { type: 'audio/wav' });
  doc.previews[data.index] = { url: URL.createObjectURL(blob) };
  doc.state = `${doc.previews.filter(Boolean).length}/${doc.questions.length}개 문항 듣기 가능`;
  if (listening && waiting?.doc === doc && waiting.index === data.index) listenAt(doc, data.index);
  if (active === doc) {
    if (!playback) { selected = data.index; loadAudio(); }
    updatePlayerCaption(); renderQuestions();
  }
  renderDocuments();
}
function selectDocument(doc, index = 0) {
  active = doc; selected = index; $('script').value = doc.text; $('show-script').checked = false;
  renderEditor(); loadAudio(); renderDocuments();
}
function renderEditor() {
  const questions = active.questions;
  $('char-count').textContent = `${active.name} · ${active.text.length.toLocaleString()}자`;
  $('question-count').textContent = questions.length ? `${questions.length}개 지문` : '대본을 기다리고 있어요';
  $('empty-practice').hidden = Boolean(questions.length); $('exercise').hidden = !questions.length;
  const notices = [...new Set(questions.flatMap(q => q.warnings))];
  if (questions.some(q => q.turns.some(t => t.type === 'chime'))) notices.unshift('차임벨은 합성 효과음으로 재현합니다.');
  if (questions.some(q => q.endPause)) notices.unshift('대본에 적힌 대기 시간을 적용합니다.');
  $('parse-notice').textContent = notices.join(' '); $('parse-notice').hidden = !notices.length;
  document.querySelectorAll('.step')[1].classList.toggle('current', Boolean(questions.length));
  renderQuestions(); if (questions.length) renderExercise();
}
function renderQuestions() {
  $('question-list').replaceChildren(...active.questions.map((q, i) => {
    const button = document.createElement('button'); button.className = `question-button${i === selected ? ' selected' : ''}`;
    const ready = Boolean(active.output || active.previews[i]);
    button.textContent = `${q.id}번${active.output ? '' : ready ? ' · 듣기' : ' · 대기'}`;
    button.disabled = !ready; button.setAttribute('aria-pressed', String(i === selected));
    button.onclick = () => {
      listenAt(active, i);
    }; return button;
  }));
}
function renderExercise() {
  const q = active.questions[selected]; if (!q) return;
  $('exercise-number').textContent = `QUESTION ${q.id.padStart(2, '0')}${q.repeat === 2 ? ' · 2회 지문' : ''}`;
  $('exercise-prompt').textContent = q.prompt || '대본을 듣고 가지고 있는 문제를 풀어보세요.';
  const subquestions = q.subquestions || [];
  $('exercise-subquestions').hidden = !subquestions.length;
  $('exercise-subquestions').replaceChildren(...subquestions.map(question => {
    const line = document.createElement('p');
    const number = document.createElement('b'); number.textContent = `${question.id}번`;
    const prompt = document.createElement('span'); prompt.textContent = question.prompt;
    line.append(number, prompt); return line;
  }));
  $('transcript').hidden = !$('show-script').checked;
  $('transcript').replaceChildren(...q.turns.map(turn => {
    const line = document.createElement('p'); const label = document.createElement('b'); label.textContent = turn.speaker || '♪';
    const text = document.createElement('span'); text.textContent = turn.text; line.append(label, text); return line;
  }));
  const answer = active.answers.get(selected);
  $('options').replaceChildren(...q.options.map(option => {
    const number = '①②③④⑤'.indexOf(option[0]) + 1; const button = document.createElement('button');
    button.className = `option-button${answer === number ? ' selected' : ''}${answer && q.answer === number ? ' correct' : ''}`;
    button.textContent = option; button.setAttribute('aria-pressed', String(answer === number));
    button.onclick = () => { active.answers.set(selected, number); renderExercise(); }; return button;
  }));
  $('answer-feedback').textContent = answer
    ? q.answer ? answer === q.answer ? '정답이에요. 잘 들었어요!' : `정답은 ${'①②③④⑤'[q.answer - 1]}번이에요. 다시 들어보세요.`
      : '답을 기록했어요. 대본에 정답이 없어 자동 채점하지 않았어요.'
    : q.options.length ? '음성을 듣고 답을 골라보세요.' : '선택지가 없는 대본이에요. 가지고 있는 문제지에서 풀어보세요.';
}
$('show-script').onchange = renderExercise;
$('script').oninput = () => {
  listening = false; waiting = undefined;
  active.text = $('script').value; active.questions = parseScript(active.text); active.answers.clear();
  discardOutput(active); active.state = active.questions.length ? `${active.questions.length}개 지문 · 생성 대기` : '영어 대본 입력 필요';
  selected = 0; renderEditor(); loadAudio(); refreshControls();
};
$('clear').onclick = () => { $('script').value = ''; $('script').oninput(); $('status').hidden = true; };
$('new-document').onclick = () => {
  if (documents.length >= 20) return showStatus('파일은 최대 20개까지 관리할 수 있어요.', true);
  const doc = newDocument(); documents.push(doc); selectDocument(doc); tab('text'); refreshControls(); $('script').focus();
};
for (const id of ['turn-gap', 'question-gap', 'repeat']) $(id).onchange = () => {
  listening = false; waiting = undefined;
  for (const doc of documents) { discardOutput(doc); if (doc.questions.length) doc.state = `${doc.questions.length}개 지문 · 설정 변경, 다시 생성`; }
  loadAudio(); refreshControls();
};

async function importFiles(files) {
  if (operation || !files.length) return;
  listening = false; waiting = undefined;
  const existing = documents.length === 1 && !active.text && active.state === '대본 입력 대기' ? 0 : documents.length;
  if (files.length + existing > 20) return showStatus('한 번에 최대 20개 파일을 관리할 수 있어요.', true);
  operation = new AbortController(); const signal = operation.signal;
  refreshControls(); $('generate').textContent = '파일을 읽는 중…';
  let reading;
  const reader = createFileReader(signal, message => {
    if (reading) { reading.state = message; renderDocuments(); showStatus(`${reading.name} · ${message}`); }
  });
  const added = []; let failed = 0;
  try {
    for (const file of files) {
      signal.throwIfAborted(); reading = newDocument(file.name); added.push(reading); documents.push(reading); renderDocuments();
      try {
        reading.text = await reader.read(file); signal.throwIfAborted();
        if (!reading.text.trim()) throw new Error('글자를 찾지 못했어요. 더 선명한 파일을 올려주세요.');
        reading.questions = parseScript(reading.text);
        if (!reading.questions.length) throw new Error('영어 대사를 찾지 못했어요. 대본을 확인해 주세요.');
        reading.state = `${reading.questions.length}개 지문 · 생성 대기`;
      } catch (error) {
        reading.state = signal.aborted ? '가져오기 취소됨' : `읽기 실패: ${error.message}`;
        if (signal.aborted) throw error; failed++;
      }
      renderDocuments();
    }
    showStatus(`${added.length}개 파일을 가져왔어요.${failed ? ` ${failed}개 읽기 실패: 목록에서 확인해 주세요.` : ''} 파일별 대본과 W/M 화자를 확인하고 전체 음성을 만드세요.`, failed > 0);
  } catch { showStatus('가져오기를 취소했어요. 이미 읽은 파일은 남겨두었어요.'); }
  finally {
    await reader.close(); operation = undefined; $('file-input').value = '';
    documents = documents.filter(d => d.text || added.includes(d));
    if (!documents.length) documents.push(newDocument());
    selectDocument(added.find(d => d.questions.length) || documents[0]); refreshControls();
  }
}
$('file-input').onchange = e => importFiles([...e.target.files]);
$('dropzone').ondragover = e => { e.preventDefault(); if (!operation) $('dropzone').classList.add('dragover'); };
$('dropzone').ondragleave = () => $('dropzone').classList.remove('dragover');
$('dropzone').ondrop = e => { e.preventDefault(); $('dropzone').classList.remove('dragover'); importFiles([...e.dataTransfer.files]); };
document.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); importFiles(files); }
});

function generate(doc, settings, progress) {
  return new Promise((resolve, reject) => {
    rejectGeneration = reject;
    if (!worker) worker = new Worker(new URL('./tts.worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => { worker?.terminate(); worker = undefined; reject(new Error('음성 엔진 실행 실패. 최신 Chrome 또는 Edge에서 다시 시도해 주세요.')); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'status') progress(data.message);
      else if (data.type === 'question') receiveQuestion(doc, data);
      else if (data.type === 'done') resolve(data);
      else if (data.type === 'error') reject(new Error(data.message));
    };
    worker.postMessage({ questions: doc.questions, ...settings });
  });
}
$('generate').onclick = async () => {
  if (operation) return;
  const targets = documents.filter(d => d.questions.length && !d.output); if (!targets.length) return;
  listening = true; waiting = { doc: targets[0], index: 0 };
  operation = new AbortController(); const signal = operation.signal; refreshControls();
  const settings = { turnGap: Number($('turn-gap').value), questionGap: Number($('question-gap').value), repeat: $('repeat').checked };
  let finished = 0; let failed = 0;
  try {
    for (const [index, doc] of targets.entries()) {
      signal.throwIfAborted();
      $('generate').textContent = `파일 ${index + 1}/${targets.length} 생성 중…`;
      try {
        const length = doc.questions.reduce((sum, q) => sum + q.turns.reduce((n, t) => n + (t.speaker ? t.text.length : 0), 0), 0);
        if (length > 25000) throw new Error('영어 대사가 25,000자를 넘어요. 이 파일을 나눠 주세요.');
        const data = await generate(doc, settings, message => {
          const ready = doc.previews.filter(Boolean).length;
          doc.state = `${ready ? `${ready}/${doc.questions.length}개 문항 듣기 가능 · ` : ''}${message}`;
          renderDocuments(); showStatus(`${index + 1}/${targets.length} · ${doc.name} · ${doc.state}`);
        });
        signal.throwIfAborted();
        const blob = new Blob([data.wav], { type: 'audio/wav' });
        doc.output = { blob, url: URL.createObjectURL(blob), markers: data.markers };
        for (const preview of doc.previews) if (preview && preview.url !== playback?.url) URL.revokeObjectURL(preview.url);
        doc.previews = [];
        doc.state = `음성 완료 · ${doc.questions.length}개 지문`; finished++;
        if (active === doc) {
          if (!playback) loadAudio();
          $('download').disabled = false;
          updatePlayerCaption(); renderQuestions();
        }
        renderDocuments();
      } catch (error) {
        if (signal.aborted) { doc.state = `생성 취소 · ${doc.previews.filter(Boolean).length}개 문항 듣기 가능`; throw error; }
        const ready = doc.previews.filter(Boolean).length;
        doc.state = `${ready ? `${ready}개 문항 듣기 가능 · ` : ''}음성 실패: ${error.message}`; failed++; renderDocuments();
      }
    }
    showStatus(`${finished}개 파일 생성 완료${failed ? ` · ${failed}개 실패: 목록에서 확인해 주세요.` : '. 파일별 WAV 또는 ZIP으로 저장하세요.'}`, failed > 0);
  } catch { showStatus('생성을 취소했어요. 완성된 파일과 문항은 계속 들을 수 있어요.'); }
  finally {
    operation = undefined; rejectGeneration = undefined;
    if (waiting && !waiting.doc.output && !waiting.doc.previews[waiting.index]) {
      listening = false; waiting = undefined; updatePlayerCaption();
    }
    refreshControls();
  }
};
$('cancel').onclick = () => {
  listening = false; waiting = undefined;
  operation?.abort(); worker?.terminate(); worker = undefined;
  rejectGeneration?.(new DOMException('취소됨', 'AbortError'));
};
function download(url, name) { const link = document.createElement('a'); link.href = url; link.download = name; link.click(); }
$('download').onclick = () => { if (active.output) download(active.output.url, outputNames(documents)[documents.indexOf(active)]); };
$('download-all').onclick = async () => {
  $('download-all').disabled = true;
  try {
    const { zipSync } = await import('fflate'); const entries = Object.create(null); const names = outputNames(documents);
    for (const [index, doc] of documents.entries()) if (doc.output) entries[names[index]] = new Uint8Array(await doc.output.blob.arrayBuffer());
    if (!Object.keys(entries).length) return;
    const url = URL.createObjectURL(new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' }));
    download(url, 'badawrite-listening.zip'); setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { showStatus(`ZIP 저장 실패: ${error.message} 파일별 WAV 저장을 이용해 주세요.`, true); }
  finally { refreshControls(); }
};
const time = seconds => `${Math.floor((seconds || 0) / 60).toString().padStart(2, '0')}:${Math.floor((seconds || 0) % 60).toString().padStart(2, '0')}`;
function playReady() {
  void audio.play().catch(() => {
    listening = false; waiting = undefined;
    showStatus('음성이 준비됐어요. 재생 버튼을 눌러주세요.');
  });
}
function listenAt(doc, index) {
  listening = true; waiting = undefined;
  if (active !== doc) selectDocument(doc, index);
  else {
    selected = index; $('show-script').checked = false;
    if (doc.output && !playback?.preview) audio.currentTime = doc.output.markers[index].start;
    else loadAudio();
    renderQuestions(); renderExercise();
  }
  playReady();
}
function advanceListening() {
  if (!listening || !playback) return false;
  let doc = playback.doc;
  let index = playback.preview ? playback.index + 1 : doc.questions.length;
  if (index >= doc.questions.length) { doc = documents[documents.indexOf(doc) + 1]; index = 0; }
  if (!doc) { listening = false; return false; }
  if (doc.output || doc.previews[index]) { listenAt(doc, index); return true; }
  else if (operation) {
    waiting = { doc, index };
    $('player-caption').textContent = '다음 문항을 준비 중이에요. 완성되면 이어서 재생해요.';
    $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', '일시정지');
    return true;
  }
  listening = false;
  return false;
}
$('play').onclick = async () => {
  if (waiting) { listening = false; waiting = undefined; updatePlayerCaption(); $('play').textContent = '▶'; $('play').setAttribute('aria-label', '재생'); return; }
  if (!playback) return;
  if (!audio.paused) { listening = false; return audio.pause(); }
  listening = true;
  if (audio.ended) {
    if (!advanceListening()) { listening = true; audio.currentTime = 0; playReady(); }
  } else playReady();
};
audio.onplay = () => { $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', '일시정지'); };
audio.onpause = () => { $('play').textContent = '▶'; $('play').setAttribute('aria-label', '재생'); };
audio.onended = () => { $('play').textContent = '▶'; $('play').setAttribute('aria-label', '재생'); advanceListening(); };
function updateTime() {
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  $('time').textContent = `${time(audio.currentTime)} / ${time(duration)}`; $('seek').max = duration || 100; $('seek').value = audio.currentTime || 0;
  const index = !playback?.preview ? active.output?.markers.findIndex(m => audio.currentTime >= m.start && audio.currentTime < m.end) ?? -1 : -1;
  if (index >= 0 && selected !== index) { selected = index; $('show-script').checked = false; renderQuestions(); renderExercise(); }
}
audio.ontimeupdate = audio.onloadedmetadata = updateTime;
$('seek').oninput = () => { audio.currentTime = Number($('seek').value); };
$('speed').onchange = () => { audio.playbackRate = Number($('speed').value); };
window.addEventListener('beforeunload', event => { if (operation || documents.some(d => d.text)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { operation?.abort(); worker?.terminate(); worker = undefined; rejectGeneration?.(new Error('페이지 닫힘')); });
refreshControls();
