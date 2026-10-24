import './theme.js';
import { parseScript } from './script.js';
import { finalizeRecording } from './final-recording.js';
import { loadExamAudio } from './exam-audio.js';
import { createFileReader } from './read-files.js';
import { outputNames } from './batch.js';
import { estimateProgress } from './progress.js';
import { parseQuestionPaper, attachQuestionPaper, questionPromptsFor, spokenQuestion, questionPaperText } from './question-paper.js';
import { deviceProfile } from './tts-runtime.js';
import { estimateQuestionDuration, planListening, speechWork } from './listening-plan.js';
import { SAMPLE_RATE } from './audio.js';

const $ = id => document.getElementById(id);
const audio = $('audio');
// Start each new app session with the visible HTML defaults, including on
// browsers that restore checkbox values from an older page version.
for (const id of ['exam-audio', 'question-chime']) $(id).checked = $(id).defaultChecked;
let profile = deviceProfile(navigator);
if (profile.lowMemory) $('device-guidance').textContent = '이 기기에서는 메모리를 아껴 순서대로 만들어요. 처음 준비하는 동안 이 화면을 열어 두세요.';
let sequence = 0;
const newDocument = name => ({ key: ++sequence, name: name || `직접입력 ${sequence}`, text: '', paper: '', questions: [], answers: new Map(), state: '대본 입력 대기', started: false, output: null, previews: [] });
let documents = [newDocument()];
let active = documents[0];
let selected = 0;
let worker;
let rejectGeneration;
let operation;
let playback;
let listening = false;
let waiting;
let automaticStart;
let generationProgress;
const questionWork = q => Math.max(1, q.turns.reduce((sum, t) => sum + (t.text?.length || 0), 0) + questionPromptsFor(q).reduce((sum, p) => sum + p.prompt.length, 0));
const parseDocument = doc => attachQuestionPaper(parseScript(doc.text), parseQuestionPaper(doc.paper));

function renderProgress() {
  renderListeningPlan();
  const bar = $('operation-progress');
  bar.hidden = !operation;
  if (!operation) { $('remaining-time').textContent = ''; return; }
  if (!generationProgress?.started || !generationProgress.completed) {
    bar.removeAttribute('value');
    $('remaining-time').textContent = generationProgress ? '첫 문항이 준비되면 예상 남은 시간을 계산해요.' : '';
    return;
  }
  const { percent } = estimateProgress(generationProgress.total, generationProgress.completed, 0);
  // Exclude the first inference's model warm-up from the speed estimate.
  const { seconds } = estimateProgress(generationProgress.total - generationProgress.baseline, generationProgress.completed - generationProgress.baseline, (performance.now() - generationProgress.started) / 1000);
  bar.value = percent;
  $('remaining-time').textContent = `${percent}% · ${seconds === null ? '예상 남은 시간 계산 중' : seconds ? `약 ${seconds < 60 ? `${seconds}초` : `${Math.ceil(seconds / 60)}분`} 남음` : '마무리 중'} · 기기에 따라 달라질 수 있어요`;
}

function readSettings() {
  return { profile, turnGap: Number($('turn-gap').value), questionGap: Number($('question-gap').value), repeat: $('repeat').checked, examAudio: $('exam-audio').checked, questionChime: $('question-chime').checked };
}
function approximateTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return value < 60 ? `${value}초` : `${Math.floor(value / 60)}분${value % 60 ? ` ${value % 60}초` : ''}`;
}
function listeningPlan(doc) {
  const settings = doc.generationSettings || readSettings();
  return planListening({
    items: doc.questions.map((q, i) => ({
      ready: Boolean(doc.output || doc.previews[i]),
      work: speechWork(q, settings.profile.lowMemory),
      duration: doc.durations?.[i] ?? estimateQuestionDuration(q, settings, i, i === doc.questions.length - 1),
    })),
    samples: doc.measurements,
    elapsed: doc.measuredAt ? (performance.now() - doc.measuredAt) / 1000 : 0,
    playbackRate: Number($('speed').value),
  });
}
function renderListeningPlan() {
  if (automaticStart) {
    const doc = automaticStart.doc;
    if (doc.generationState === 'failed') automaticStart = undefined;
    else if (listeningPlan(doc).canStart) {
      automaticStart = undefined;
      listenAt(doc, 0);
    }
  }
  const plan = listeningPlan(active);
  $('listening-estimate').textContent = active.questions.length ? `${active.output ? '전체 듣기' : '예상 전체 듣기'} 약 ${approximateTime(plan.totalSeconds)} · ${$('speed').value}배속` : '';
  const pending = automaticStart?.doc === active;
  $('listening-buffer').textContent = pending
    ? plan.waitSeconds === null || !plan.waitSeconds ? '이어 듣기 준비 중 · 문항 생성 속도를 측정하고 있어요.'
      : `이어 듣기 자동 시작까지 약 ${approximateTime(plan.waitSeconds)} · 충분히 준비되면 재생해요.`
    : active.generationState === 'failed' ? '생성이 중단됐어요. 완성된 문항은 번호를 눌러 들을 수 있어요.'
      : !audio.paused && playback?.doc === active ? active.output ? '이어 듣기 재생 중이에요.' : '이어 듣는 동안 나머지 문항을 계속 만들어요.'
        : '준비된 문항부터 바로 듣거나 자동 시작을 선택할 수 있어요.';
  $('start-listening').disabled = !(active.output || active.previews[0]);
  $('auto-listening').hidden = !operation || !active.questions.length;
  $('auto-listening').textContent = pending ? '자동 시작 취소' : '준비되면 자동 시작';
}

function showStatus(message, error = false) {
  $('status').hidden = false;
  $('status').classList.toggle('error', error);
  $('status-message').textContent = message;
  renderProgress();
}
function refreshControls() {
  const busy = Boolean(operation);
  for (const id of ['script', 'file-input', 'clear', 'new-document', 'turn-gap', 'question-gap', 'repeat', 'exam-audio', 'question-chime', 'paper-input', 'question-paper']) $(id).disabled = busy;
  $('remove-paper').disabled = busy || !active.paper;
  const count = documents.filter(d => d.questions.length && !d.output).length;
  $('generate').disabled = busy || !count;
  if (!busy) {
    $('generate').textContent = !count && documents.some(d => d.output) ? '음성 생성 완료'
      : count > 1 ? `남은 ${count}개 파일 음성 만들기 →` : '듣기 만들기 →';
  }
  $('cancel').hidden = !busy;
  $('download-all').disabled = busy || !documents.some(d => d.output);
  // Keep a single failed file visible so its error can be inspected.
  $('batch-panel').hidden = documents.length < 2 && !documents.some(d => /실패|취소/.test(d.state));
  renderDocuments(); renderQuestions(); renderProgress();
}
function discardOutput(doc) {
  if (doc.output) URL.revokeObjectURL(doc.output.url);
  for (const preview of doc.previews) if (preview) URL.revokeObjectURL(preview.url);
  doc.output = null;
  doc.previews = [];
  doc.started = false;
  doc.durations = []; doc.measurements = []; doc.generationSettings = undefined; doc.generationState = undefined;
}
function renderDocuments() {
  $('batch-count').textContent = `${documents.length}개 파일 · ${documents.filter(d => d.output).length}개 완료`;
  $('document-list').replaceChildren(...documents.map(doc => {
    const row = document.createElement('div'); row.className = 'document-row';
    const button = document.createElement('button'); button.className = `document-select${doc === active ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(doc === active));
    const name = document.createElement('strong'); name.textContent = doc.name;
    const info = document.createElement('small'); info.textContent = doc.state;
    button.append(name, info); button.onclick = () => { automaticStart = undefined; listening = false; waiting = undefined; selectDocument(doc); };
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
  const revealing = track && $('practice').hidden;
  $('practice').hidden = !track;
  if (revealing) {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => $('practice').scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }));
  }
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
  const cues = active.output?.cues;
  $('export-content').hidden = !cues;
  $('export-content').textContent = cues ? `저장 WAV·ZIP: 시작 안내 ${cues.intro ? '포함' : '자동 삽입 끔'} · 문항 시작 차임벨 ${cues.chime ? '포함' : '자동 삽입 끔'}` : '';
  const ready = active.previews.filter(Boolean).length;
  const previewing = playback?.doc === active && playback.preview;
  $('track-title').textContent = previewing ? `${active.name} · ${active.questions[selected].id}번` : active.output ? active.name : '나만의 듣기 파일';
  $('player-caption').textContent = active.output ? previewing ? '전체 생성 완료 · 다른 문항도 선택해 들을 수 있어요' : '문항을 선택하면 해당 지문으로 이동해요'
    : ready ? `${ready}/${active.questions.length}개 문항 듣기 가능 · 완료된 문항부터 재생하세요` : '선택한 파일의 음성을 만들면 여기서 재생돼요';
}
function receiveQuestion(doc, data) {
  if (doc.previews[data.index]) URL.revokeObjectURL(doc.previews[data.index].url);
  const blob = new Blob([data.wav], { type: 'audio/wav' });
  doc.previews[data.index] = { blob, url: URL.createObjectURL(blob) };
  (doc.durations ||= [])[data.index] = (blob.size - 44) / (SAMPLE_RATE * 2);
  doc.state = `${doc.previews.filter(Boolean).length}/${doc.questions.length}개 문항 듣기 가능`;
  const firstReady = data.index === 0 && listening && waiting?.doc === doc && waiting.index === 0;
  if (listening && waiting?.doc === doc && waiting.index === data.index) listenAt(doc, data.index);
  if (active === doc) {
    if (!playback) { selected = data.index; loadAudio(); }
    updatePlayerCaption(); renderQuestions();
  }
  renderDocuments();
  renderListeningPlan();
  if (firstReady) $('question-progress').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function selectDocument(doc, index = 0) {
  active = doc; selected = index; $('script').value = doc.text; $('show-script').checked = false;
  $('question-paper').value = doc.paper;
  $('remove-paper').disabled = Boolean(operation) || !doc.paper;
  renderEditor(); loadAudio(); renderDocuments();
}
function renderEditor() {
  const questions = active.questions;
  const paperQuestions = parseQuestionPaper(active.paper);
  const attached = new Set(questions.flatMap(q => questionPromptsFor(q).map(p => p.id)));
  const linked = questions.filter(q => questionPromptsFor(q).length).length;
  $('paper-summary').textContent = !active.paper.trim() ? '연결된 문제지 없음' : !paperQuestions.length ? '한국어 질문을 찾지 못했어요. 문항 번호와 질문을 확인해 주세요.' : `${linked}/${questions.length}개 지문 · ${attached.size}개 질문 연결 · ${paperQuestions.filter(q => !attached.has(q.id)).length}개 번호 불일치 · 추출 문구를 확인해 주세요`;
  $('char-count').textContent = `${active.name} · ${active.text.length.toLocaleString()}자`;
  $('question-count').textContent = questions.length ? `${questions.length}개 지문` : '대본을 기다리고 있어요';
  $('empty-practice').hidden = Boolean(questions.length); $('exercise').hidden = !questions.length;
  const notices = [...new Set(questions.flatMap(q => q.warnings))];
  if (questions.length && ($('question-chime').checked || questions.some(q => q.turns.some(t => t.type === 'chime')))) notices.unshift($('exam-audio').checked ? '문항 차임벨은 수능 원본 효과음을 사용합니다.' : '문항 차임벨은 합성 효과음으로 재현합니다.');
  if (questions.some(q => q.endPause)) notices.unshift('대본에 적힌 대기 시간을 적용합니다.');
  $('parse-notice').textContent = notices.join(' '); $('parse-notice').hidden = !notices.length;
  document.querySelectorAll('.step')[1].classList.toggle('current', Boolean(questions.length));
  renderQuestions(); if (questions.length) renderExercise();
  renderListeningPlan();
}
function renderQuestions() {
  const readyCount = active.output ? active.questions.length : active.previews.filter(Boolean).length;
  $('question-progress').hidden = !active.questions.length || !(active.started || readyCount);
  $('ready-count').textContent = `${readyCount}/${active.questions.length}개 준비됨`;
  $('question-list').replaceChildren(...active.questions.map((q, i) => {
    const button = document.createElement('button'); button.className = `question-button${i === selected ? ' selected' : ''}`;
    const ready = Boolean(active.output || active.previews[i]);
    button.textContent = `${q.id}번${active.output ? '' : ready ? ' · 듣기' : ' · 대기'}`;
    button.disabled = !ready; button.setAttribute('aria-pressed', String(i === selected));
    button.onclick = () => {
      listenAt(active, i);
      $('practice').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }; return button;
  }));
}
function renderExercise() {
  const q = active.questions[selected]; if (!q) return;
  $('exercise-number').textContent = `QUESTION ${q.id.padStart(2, '0')}${q.repeat === 2 ? ' · 2회 지문' : ''}`;
  $('exercise-prompt').textContent = q.prompt || '영어 지문을 들어보세요.';
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
    const line = document.createElement('p'); const label = document.createElement('b'); label.textContent = turn.label || turn.speaker || '♪';
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
    : q.options.length ? '음성을 듣고 답을 골라보세요.' : q.prompt || subquestions.length ? '가지고 있는 문제지에서 풀어보세요.' : '대본 보기를 켜면 영어 원문을 함께 확인할 수 있어요.';
}
$('show-script').onchange = renderExercise;
$('script').oninput = () => {
  automaticStart = undefined; listening = false; waiting = undefined;
  active.text = $('script').value; active.questions = parseDocument(active); active.answers.clear();
  discardOutput(active); active.state = active.questions.length ? `${active.questions.length}개 지문 · 생성 대기` : '영어 대본 입력 필요';
  selected = 0; renderEditor(); loadAudio(); refreshControls();
};
$('clear').onclick = () => { $('script').value = ''; $('script').oninput(); $('status').hidden = true; };
$('question-paper').oninput = () => {
  active.paper = $('question-paper').value;
  $('script').oninput();
};
$('remove-paper').onclick = () => { $('question-paper').value = ''; $('question-paper').oninput(); };
$('paper-input').onchange = async event => {
  const file = event.target.files[0];
  if (!file || operation) return;
  const doc = active;
  operation = new AbortController(); const signal = operation.signal;
  listening = false; waiting = undefined;
  refreshControls(); showStatus(`${file.name} · 문제지 읽는 중`);
  const reader = createFileReader(signal, message => showStatus(`${file.name} · ${message}`));
  try {
    const text = await reader.read(file, { raw: true }); signal.throwIfAborted();
    if (text.length > 50000) throw new Error('문제지 텍스트는 50,000자까지 지원해요. 듣기 문제 부분만 나눠 주세요.');
    const prompts = questionPaperText(text);
    if (!prompts) throw new Error('1~17번의 한국어 문제 문구를 찾지 못했어요. 문구만 직접 입력해 주세요.');
    doc.paper = prompts; doc.questions = parseDocument(doc); doc.answers.clear(); discardOutput(doc);
    doc.state = doc.questions.length ? `${doc.questions.length}개 지문 · 문제지 연결, 다시 생성` : '영어 대본 입력 필요';
    showStatus('문제 문구만 가져왔어요. 선지·표·전체 안내문은 제외했어요. 번호와 추출 문구를 확인해 주세요.');
  } catch (error) { showStatus(signal.aborted ? '문제지 가져오기를 취소했어요. 기존 연결은 유지됩니다.' : `문제지 읽기 실패: ${error.message}`, !signal.aborted); }
  finally {
    await reader.close(); operation = undefined; $('paper-input').value = '';
    selectDocument(active); refreshControls();
  }
};
$('new-document').onclick = () => {
  if (documents.length >= 20) return showStatus('파일은 최대 20개까지 관리할 수 있어요.', true);
  const doc = newDocument(); documents.push(doc); selectDocument(doc); refreshControls(); $('script').focus();
};
for (const id of ['turn-gap', 'question-gap', 'repeat', 'exam-audio', 'question-chime']) $(id).onchange = () => {
  automaticStart = undefined; listening = false; waiting = undefined;
  for (const doc of documents) { discardOutput(doc); if (doc.questions.length) doc.state = `${doc.questions.length}개 지문 · 설정 변경, 다시 생성`; }
  loadAudio(); renderEditor(); refreshControls();
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
        reading.questions = parseDocument(reading);
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

function prepareKorean(prompts, progress) {
  // Reclaim the previous English engine before preparing the Korean engine.
  worker?.terminate();
  worker = new Worker(new URL('./korean.worker.js', import.meta.url), { type: 'module' });
  const preparation = worker;
  return new Promise((resolve, reject) => {
    rejectGeneration = reject;
    preparation.onerror = () => { preparation.terminate(); worker = undefined; reject(new Error('질문 음성 준비가 중단됐어요. 다른 탭을 닫고 다시 시도해 주세요.')); };
    preparation.onmessage = ({ data }) => {
      if (data.type === 'status') progress(data.message);
      else if (data.type === 'done' || data.type === 'error') {
        // End the entire WASM runtime before the next model is created.
        preparation.terminate(); worker = undefined;
        if (data.type === 'done') resolve(data.clips);
        else reject(new Error(data.message));
      }
    };
    preparation.postMessage({ prompts });
  });
}

async function generate(doc, settings, progress) {
  let koreanClips;
  if (settings.profile.lowMemory) {
    const prompts = [...new Set(doc.questions.flatMap(questionPromptsFor).map(spokenQuestion))];
    if (prompts.length) koreanClips = await prepareKorean(prompts, progress);
    operation?.signal.throwIfAborted();
  }
  return new Promise((resolve, reject) => {
    rejectGeneration = reject;
    if (!worker) worker = new Worker(new URL('./tts.worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => { worker?.terminate(); worker = undefined; reject(new Error('음성 엔진이 중단됐어요. 다른 탭을 닫고 대본을 나눠 다시 시도해 주세요.')); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'status') progress(data.message);
      else if (data.type === 'inference') {
        doc.measurements = []; doc.measuredAt = performance.now();
        if (generationProgress && !generationProgress.started) generationProgress.started = performance.now();
      }
      else if (data.type === 'progress' && generationProgress) {
        const now = performance.now();
        (doc.measurements ||= []).push({ work: speechWork(doc.questions[data.index], settings.profile.lowMemory), seconds: Math.max(0.001, data.seconds ?? (now - (doc.measuredAt || now)) / 1000) });
        doc.measuredAt = now;
        const key = `${doc.key}/${data.index}`;
        if (!generationProgress.done.has(key)) {
          generationProgress.done.add(key);
          generationProgress.completed += questionWork(doc.questions[data.index]);
          if (generationProgress.baseline === undefined) {
            generationProgress.baseline = generationProgress.completed;
            generationProgress.started = performance.now();
          }
        }
        renderProgress();
      }
      else if (data.type === 'question') receiveQuestion(doc, data);
      else if (data.type === 'done') {
        if (settings.profile.lowMemory) { worker.terminate(); worker = undefined; }
        resolve(data);
      }
      else if (data.type === 'error' && data.retryWithWasm && !settings.forceWasm) {
        // A failed ONNX session can poison the inference queue. Use a fresh
        // worker for CPU fallback, retaining already playable question previews.
        worker.terminate(); worker = undefined;
        progress('이 기기에서는 GPU 가속을 사용할 수 없어 CPU로 전환해요.');
        profile = deviceProfile(navigator, { safe: true });
        $('device-guidance').textContent = '이 기기에서는 메모리를 아껴 순서대로 만들어요. 처음 준비하는 동안 이 화면을 열어 두세요.';
        settings.profile = profile; settings.forceWasm = true;
        generate(doc, settings, progress).then(resolve, reject);
      }
      else if (data.type === 'error') {
        worker.terminate(); worker = undefined;
        reject(new Error(data.message));
      }
    };
    worker.postMessage({ questions: doc.questions, ...settings, koreanClips, skipPreviews: doc.previews.flatMap((preview, index) => preview ? [index] : []) }, (koreanClips || []).map(clip => clip.samples.buffer));
  });
}
$('generate').onclick = async () => {
  if (operation) return;
  const targets = documents.filter(d => d.questions.length && !d.output); if (!targets.length) return;
  const settings = readSettings();
  for (const doc of targets) {
    doc.started = true; doc.generationSettings = settings; doc.measurements = []; doc.measuredAt = undefined; doc.generationState = 'queued';
  }
  generationProgress = { total: targets.reduce((sum, doc) => sum + doc.questions.reduce((n, q) => n + questionWork(q), 0), 0), completed: 0, started: 0, done: new Set() };
  const progressTimer = setInterval(renderProgress, 1000);
  automaticStart = { doc: targets[0] };
  listening = false; waiting = undefined; audio.pause();
  operation = new AbortController(); const signal = operation.signal; refreshControls();
  showStatus('음성 생성을 준비하고 있어요. 이어 듣기 시작 시간도 계산해요.');
  let finished = 0; let failed = 0; let failureMessage;
  try {
    for (const [index, doc] of targets.entries()) {
      signal.throwIfAborted();
      doc.generationState = 'running';
      $('generate').textContent = `파일 ${index + 1}/${targets.length} 생성 중…`;
      try {
        const length = doc.questions.reduce((sum, q) => sum + q.turns.reduce((n, t) => n + (t.speaker ? t.text.length : 0), 0), 0);
        if (length > 25000) throw new Error('영어 대사가 25,000자를 넘어요. 이 파일을 나눠 주세요.');
        const prompts = doc.questions.flatMap(questionPromptsFor);
        if (doc.paper.trim() && !prompts.length) throw new Error('문제지와 대본의 문항 번호가 맞지 않아요. 한국어 질문 연결을 확인해 주세요.');
        if (prompts.some(p => p.prompt.length > 1000) || prompts.reduce((sum, p) => sum + p.prompt.length, 0) > 8000) throw new Error('한국어 질문은 문항당 1,000자, 파일당 8,000자까지 지원해요. 잘못 추출된 문구를 정리해 주세요.');
        // Keep the small cue assets available in the UI until final export,
        // even if the network disappears during a long generation.
        if (settings.examAudio) await loadExamAudio({ signal });
        signal.throwIfAborted();
        await generate(doc, settings, message => {
          const ready = doc.previews.filter(Boolean).length;
          doc.state = `${ready ? `${ready}/${doc.questions.length}개 문항 듣기 가능 · ` : ''}${message}`;
          renderDocuments(); showStatus(`${index + 1}/${targets.length} · ${doc.name} · ${doc.state}`);
        });
        signal.throwIfAborted();
        doc.state = '저장 파일의 시작 안내·차임벨 확인 중';
        renderDocuments();
        const recording = await finalizeRecording(doc.questions.map((_, i) => doc.previews[i]?.blob), doc.questions, settings, signal);
        signal.throwIfAborted();
        doc.durations = recording.durations;
        doc.output = { ...recording, url: URL.createObjectURL(recording.blob) };
        for (const preview of doc.previews) if (preview && preview.url !== playback?.url) URL.revokeObjectURL(preview.url);
        doc.previews = [];
        doc.state = `음성 완료 · ${doc.questions.length}개 지문`; finished++;
        doc.generationState = 'complete';
        if (active === doc) {
          if (!playback) loadAudio();
          $('download').disabled = false;
          updatePlayerCaption(); renderQuestions();
        }
        renderDocuments();
      } catch (error) {
        doc.generationState = 'failed';
        if (signal.aborted) { doc.state = `생성 취소 · ${doc.previews.filter(Boolean).length}개 문항 듣기 가능`; throw error; }
        const ready = doc.previews.filter(Boolean).length;
        failureMessage = error.message;
        doc.state = `${ready ? `${ready}개 문항 듣기 가능 · ` : ''}음성 실패: ${error.message}`; failed++; renderDocuments();
      }
    }
    showStatus(`${finished}개 파일 생성 완료${failed ? ` · ${failed}개 실패: ${targets.length === 1 ? failureMessage : '목록에서 확인해 주세요.'}` : '. 파일별 WAV 또는 ZIP으로 저장하세요.'}`, failed > 0);
  } catch { showStatus('생성을 취소했어요. 완성된 파일과 문항은 계속 들을 수 있어요.'); }
  finally {
    clearInterval(progressTimer); generationProgress = undefined;
    operation = undefined; rejectGeneration = undefined;
    // A completed first file can now start even when there was only one
    // question; failed/cancelled files never leave a delayed auto-start behind.
    renderListeningPlan();
    if (waiting && !waiting.doc.output && !waiting.doc.previews[waiting.index]) {
      listening = false; waiting = undefined; updatePlayerCaption();
    }
    refreshControls();
  }
};
$('cancel').onclick = () => {
  automaticStart = undefined; listening = false; waiting = undefined;
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
  automaticStart = undefined; listening = true; waiting = undefined;
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
  if (index >= doc.questions.length || (doc.generationState === 'failed' && !doc.output && !doc.previews[index])) {
    doc = documents.slice(documents.indexOf(doc) + 1).find(next => next.questions.length && (next.generationState !== 'failed' || next.output || next.previews[0])); index = 0;
  }
  if (!doc) { listening = false; return false; }
  if (doc !== playback.doc && !doc.output && operation) {
    listening = false; waiting = undefined;
    selectDocument(doc);
    automaticStart = { doc };
    renderListeningPlan();
    return true;
  }
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
  if (automaticStart) { automaticStart = undefined; if (active.output || active.previews[selected]) listenAt(active, selected); renderListeningPlan(); return; }
  if (waiting) { listening = false; waiting = undefined; updatePlayerCaption(); $('play').textContent = '▶'; $('play').setAttribute('aria-label', '재생'); return; }
  if (!playback) return;
  if (!audio.paused) { listening = false; return audio.pause(); }
  listening = true;
  if (audio.ended) {
    if (!advanceListening()) { listening = true; audio.currentTime = 0; playReady(); }
  } else playReady();
};
$('start-listening').onclick = () => { listenAt(active, 0); renderListeningPlan(); };
$('auto-listening').onclick = () => {
  if (automaticStart?.doc === active) automaticStart = undefined;
  else { audio.pause(); listening = false; waiting = undefined; automaticStart = { doc: active }; }
  renderListeningPlan();
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
$('speed').onchange = () => { audio.playbackRate = Number($('speed').value); renderListeningPlan(); };
window.addEventListener('beforeunload', event => { if (operation || documents.some(d => d.text)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { automaticStart = undefined; operation?.abort(); worker?.terminate(); worker = undefined; rejectGeneration?.(new Error('페이지 닫힘')); });
refreshControls();
