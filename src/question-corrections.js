// Verified against the supplied scan at different sizes/layouts, plus explicit
// user corrections. Keep rules narrow: never infer negation, numbers or names.
// Capture a boundary rather than using lookbehind for older iPad browsers.
export const questionCorrections = [
  {
    pattern: /(^|[^가-힣A-Za-z0-9])기장(?=\s*(?:적절한|적절핫|저절한|저청한|정청한|적절찬|적정한|적절할|AAR|ART|GEA)\s*것(?:을|은))/g,
    replacement: '$1가장',
  },
  {
    pattern: /(가장\s*)(?:적절핫|저절한|저청한|정청한|적절찬|AAR|ART|GEA)(?=\s*것(?:을\s*(?:고르|선택)|은\s*[?？]))/g,
    replacement: '$1적절한',
  },
  {
    pattern: /(^|[^가-힣A-Za-z0-9])(?:적절핫|저절한|저청한|정청한|적절찬)(?=\s*(?:것|말|응답|답|표현|의견|요지|제목)|\s*[.!?。？]?\s*$)/g,
    replacement: '$1적절한',
  },
  {
    pattern: /((?:남자|여자)의\s*)(?:옹답|옹담|응담)(?=으로\s*가장)/g,
    replacement: '$1응답',
  },
  { pattern: /남지가(?=\s*하는\s*(?:말|맡))/g, replacement: '남자가' },
  { pattern: /(하는\s*)맡(?=\s*의\s*(?:목적|요지|주제|내용))/g, replacement: '$1말' },
  { pattern: /(말의\s*)(?:요기|유지)(?=로\s*가장)/g, replacement: '$1요지' },
  { pattern: /((?:남자|여자)의\s*)의건(?=으로\s*가장)/g, replacement: '$1의견' },
  { pattern: /(것을\s*)르시오(?=\s*[.,，。]?\s*$)/g, replacement: '$1고르시오' },
  { pattern: /^(다음을\s*듣고[,]?\s*)S80(?=\s*답하시오)/g, replacement: '$1물음에' },
  // 적정한/적절할 are valid Korean. Only normalise them in the fixed
  // purpose/opinion/response question frames confirmed in the source paper.
  {
    pattern: /((?:목적으로|의견으로|요지로|주제로|응답으로)\s*가장\s*)(?:적정한|적절할)(?=\s*것(?:을\s*(?:고르|선택)|은\s*[?？]))/g,
    replacement: '$1적절한',
  },
];

export function correctQuestionPrompt(text) {
  return questionCorrections.reduce((result, rule) => result.replace(rule.pattern, rule.replacement), String(text || ''));
}
