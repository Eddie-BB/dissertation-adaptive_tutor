function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAny(text, phrases) {
  return (phrases || []).some(phrase => text.includes(phrase));
}

function detectTaskCategory(text) {
  if (containsAny(text, ['solve', 'calculate', 'compute', 'determine', 'find'])) return 'solve';
  if (containsAny(text, ['explain', 'justify', 'why', 'reason'])) return 'explain';
  if (containsAny(text, ['compare', 'contrast', 'analyze'])) return 'analysis';
  if (containsAny(text, ['prove', 'derive', 'demonstrate'])) return 'proof';
  if (containsAny(text, ['repeat', 'again', 'same as before'])) return 'repeat';
  return 'general';
}

function detectStructureCategory(text) {
  if (containsAny(text, ['first', 'then', 'next', 'finally', 'step'])) return 'stepwise';
  if (containsAny(text, ['what do you think', 'why', '?'])) return 'question_led';
  if (containsAny(text, ['let me', 'try to', 'consider', 'notice'])) return 'guided';
  if (containsAny(text, ['for example', 'example', 'suppose'])) return 'example_based';
  if (containsAny(text, ['choose', 'option', 'either'])) return 'choice_based';
  return 'directive';
}

function scoreTaskSimilarity(currentText, priorText) {
  const current = normalizeText(currentText);
  const prior = normalizeText(priorText);
  const currentCategory = detectTaskCategory(current);
  const priorCategory = detectTaskCategory(prior);

  if (current === prior) return 0.9;
  if (currentCategory === priorCategory) {
    if (currentCategory === 'general') return 0.6;
    return containsAny(current, ['again', 'same']) || containsAny(prior, ['again', 'same']) ? 0.9 : 0.8;
  }
  if (
    (currentCategory === 'solve' && priorCategory === 'explain')
    || (currentCategory === 'explain' && priorCategory === 'solve')
  ) {
    return 0.4;
  }
  return 0.2;
}

function scoreStructureSimilarity(currentText, priorText) {
  const current = normalizeText(currentText);
  const prior = normalizeText(priorText);
  const currentCategory = detectStructureCategory(current);
  const priorCategory = detectStructureCategory(prior);

  if (current === prior) return 0.9;
  if (currentCategory === priorCategory) return 0.8;
  if (
    (currentCategory === 'guided' && priorCategory === 'stepwise')
    || (currentCategory === 'stepwise' && priorCategory === 'guided')
  ) {
    return 0.6;
  }
  if (
    (currentCategory === 'directive' && priorCategory === 'question_led')
    || (currentCategory === 'question_led' && priorCategory === 'directive')
  ) {
    return 0.4;
  }
  return 0.2;
}

function makeAnchoredReason(name, score, description) {
  return `${name}: ${description} (${score.toFixed(2)})`;
}

function buildTaskSignature(teacherMessage = '') {
  const text = normalizeText(teacherMessage);
  return {
    task_category: detectTaskCategory(text),
    structure_category: detectStructureCategory(text)
  };
}

function buildComponentScores({
  teacherMessage,
  visibleHistory = []
}) {
  const historyTexts = Array.isArray(visibleHistory)
    ? visibleHistory
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }
        return item?.teacher_message || item?.teacherMessage || '';
      })
      .filter(Boolean)
      .slice(-3)
    : [];
  const text = normalizeText(teacherMessage);

  let m1Score = 0.2;
  let m2Score = 0.2;
  let m1Reason = 'M1: no prior teacher turns';
  let m2Reason = 'M2: no prior teacher turns';
  let m1SimilarityList = [];
  let m2SimilarityList = [];

  if (historyTexts.length > 0) {
    m1SimilarityList = historyTexts.map((priorText, index) => ({
      turn_id: `prior_${index + 1}`,
      sim_i: scoreTaskSimilarity(teacherMessage, priorText)
    }));
    m2SimilarityList = historyTexts.map((priorText, index) => ({
      turn_id: `prior_${index + 1}`,
      sim_i: scoreStructureSimilarity(teacherMessage, priorText)
    }));
    m1Score = Number((m1SimilarityList.reduce((sum, item) => sum + item.sim_i, 0) / m1SimilarityList.length).toFixed(2));
    m2Score = Number((m2SimilarityList.reduce((sum, item) => sum + item.sim_i, 0) / m2SimilarityList.length).toFixed(2));
    m1Reason = makeAnchoredReason('M1', m1Score, 'task repetition scored against prior teacher turns');
    m2Reason = makeAnchoredReason('M2', m2Score, 'structural repetition scored against prior teacher turns');
  }

  const specific = containsAny(text, ['calculate', 'solve', 'equilibrium', 'value', 'expression', 'substitute', 'formula', 'step']);
  const generic = containsAny(text, ['try', 'keep going', 'do your best', 'work on it', 'think about it']);
  let m3Score = 0.5;
  if (specific && !generic) m3Score = 0.3;
  if (!specific && generic) m3Score = 0.7;
  if (text.length < 20 && !specific) m3Score = 1.0;

  const hasChoice = containsAny(text, ['choose', 'option', 'either', 'what do you think', 'would you rather']);
  const hasDirective = containsAny(text, ['do', 'write', 'calculate', 'tell me', 'show', 'identify']);
  let m4Score = 0.5;
  if (hasChoice && !hasDirective) m4Score = 0.0;
  else if (hasChoice) m4Score = 0.3;
  else if (hasDirective) m4Score = 0.7;
  if (hasDirective && !hasChoice && text.split(' ').length < 10) m4Score = 1.0;

  let r1Score = 0.0;
  if (containsAny(text, ['because', 'so that', 'this helps', 'in order to'])) r1Score = 0.7;
  if (containsAny(text, ['goal', 'purpose', 'so you can'])) r1Score = 1.0;

  let r2Score = 0.3;
  if (containsAny(text, ['calculate', 'write', 'identify', 'substitute', 'solve'])) r2Score = 0.7;
  if (containsAny(text, ['then', 'next', 'after', 'final answer', 'scientific notation'])) r2Score = 1.0;

  let r3Score = 0.5;
  if (containsAny(text, ['good', 'nice', 'well done', 'take your time', 'you can'])) r3Score = 0.7;
  if (containsAny(text, ['great', 'excellent', 'youve got this'])) r3Score = 1.0;
  if (containsAny(text, ['wrong', 'bad', 'stop', 'terrible'])) r3Score = 0.0;

  let r4Score = 0.0;
  if (containsAny(text, ['what do you think', 'tell me', 'explain', 'would you rather'])) r4Score = 0.7;
  if (containsAny(text, ['choose', 'option', 'either'])) r4Score = 1.0;
  if (containsAny(text, ['calculate', 'write']) && !containsAny(text, ['think', 'choose', 'explain'])) r4Score = 0.3;

  return {
    componentScores: {
      M1: { value: m1Score, reason: m1Reason },
      M2: { value: m2Score, reason: m2Reason },
      M3: { value: m3Score, reason: makeAnchoredReason('M3', m3Score, 'linguistic genericness from current message only') },
      M4: { value: m4Score, reason: makeAnchoredReason('M4', m4Score, 'absence of choice from current message only') },
      R1: { value: r1Score, reason: makeAnchoredReason('R1', r1Score, 'relevance or purpose from current message only') },
      R2: { value: r2Score, reason: makeAnchoredReason('R2', r2Score, 'payoff and outcome clarity from current message only') },
      R3: { value: r3Score, reason: makeAnchoredReason('R3', r3Score, 'encouragement and safety from current message only') },
      R4: { value: r4Score, reason: makeAnchoredReason('R4', r4Score, 'autonomy and agency from current message only') }
    },
    historyFeatures: {
      m1_similarity_list: m1SimilarityList,
      m2_similarity_list: m2SimilarityList
    }
  };
}

async function scoreAppraisalComponents({
  teacherMessage,
  visibleHistory = []
} = {}) {
  const { componentScores, historyFeatures } = buildComponentScores({
    teacherMessage,
    visibleHistory
  });

  return {
    scorerType: 'deterministic',
    taskSignature: buildTaskSignature(teacherMessage),
    componentScores,
    historyFeatures,
    llm_appraisal_failed: false,
    fallback_used: null
  };
}

export {
  clamp01,
  normalizeText,
  containsAny,
  buildTaskSignature,
  buildComponentScores,
  scoreAppraisalComponents
};

export default { scoreAppraisalComponents };
