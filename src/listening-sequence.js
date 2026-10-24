import { questionPromptsFor, spokenQuestion } from './question-paper.js';

export function isSharedListening(question) {
  return /^16\s*[–~\-∼]\s*17$/.test(question.id);
}

export function questionSpeechPlan(question, settings = {}) {
  const linked = questionPromptsFor(question);
  if (!isSharedListening(question)) return { before: linked.map(spokenQuestion), between: [], after: [] };
  const inline = questionPromptsFor({ questionPrompts: question.subquestions || [] });
  const byId = new Map([...inline, ...linked].map(prompt => [prompt.id, prompt]));
  const common = linked.find(prompt => /^16[–~\-∼]17$/.test(prompt.id))
    || questionPromptsFor({ questionPrompts: [{ id: question.id, prompt: question.prompt }] })[0]
    || { id: question.id, prompt: '다음을 듣고, 물음에 답하시오.' };
  const individual = ['16', '17'].map(id => byId.get(id)).filter(Boolean);
  const pauses = new Map((question.subquestions || []).map(q => [q.id, q.endPause]));
  const hasIndividualPauses = [...pauses.values()].some(seconds => seconds > 0);
  const selected = Number(settings.sharedQuestionGap ?? 10);
  const defaultPause = Number.isFinite(selected) ? Math.min(60, Math.max(0, selected)) : 10;
  return {
    before: [`십육번부터 십칠번까지는 두 번 들려줍니다. ${spokenQuestion(common)}`],
    between: ['다시 한 번 듣겠습니다.'],
    after: individual.map(prompt => ({
      text: spokenQuestion(prompt),
      pause: pauses.get(prompt.id) > 0 ? pauses.get(prompt.id)
        : !hasIndividualPauses && question.endPause > 0 ? question.endPause / individual.length : defaultPause,
    })),
  };
}

// The UI's low-memory preparation and the inference worker must use identical
// strings, including the fixed announcements that do not come from a paper.
export function questionSpeechTexts(question) {
  const plan = questionSpeechPlan(question);
  return [...plan.before, ...plan.between, ...plan.after.map(item => item.text)];
}

export function questionEndGap(question, settings = {}, last = false) {
  const plan = questionSpeechPlan(question, settings);
  return plan.after.length ? plan.after.at(-1).pause : question.endPause || (!last ? settings.questionGap || 0 : 0);
}
