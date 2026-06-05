const SCORE_BY_CATEGORY = {
  correct: 1,
  partially_correct: 0.5,
  misconception: 0,
  incorrect: 0,
  unknown: 0
};

function createObservedBucket() {
  return {
    attempts: 0,
    failedAttempts: 0,
    failedAttemptsFloat: 0,
    correctAttempts: 0,
    partialAttempts: 0,
    misconceptionAttempts: 0,
    unknownAttempts: 0,
    correctnessScoreTotal: 0,
    correctnessScore: 0,
    averageCorrectnessScore: 0,
    lastCategory: null,
    lastFeedbackType: null,
    missingConcepts: [],
    misconceptionIds: []
  };
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getCorrectnessScore(validationResult) {
  if (Number.isFinite(validationResult.correctnessScore)) {
    return validationResult.correctnessScore;
  }

  return SCORE_BY_CATEGORY[validationResult.category] ?? 0;
}

function getFailureWeight(validationResult) {
  if (validationResult.category === "correct") {
    return 0;
  }

  if (validationResult.category === "partially_correct") {
    return 0.5;
  }

  return 1;
}

function updateBucket(bucket, validationResult) {
  const nextBucket = {
    ...createObservedBucket(),
    ...bucket
  };
  const correctnessScore = getCorrectnessScore(validationResult);
  const failureWeight = getFailureWeight(validationResult);

  nextBucket.attempts += 1;
  nextBucket.failedAttempts += validationResult.isCorrect ? 0 : 1;
  nextBucket.failedAttemptsFloat += failureWeight;
  nextBucket.correctAttempts += validationResult.isCorrect ? 1 : 0;
  nextBucket.partialAttempts += validationResult.category === "partially_correct" ? 1 : 0;
  nextBucket.misconceptionAttempts += validationResult.category === "misconception" ? 1 : 0;
  nextBucket.unknownAttempts += validationResult.category === "unknown" ? 1 : 0;
  nextBucket.correctnessScore = correctnessScore;
  nextBucket.correctnessScoreTotal += correctnessScore;
  nextBucket.averageCorrectnessScore =
    nextBucket.attempts > 0 ? nextBucket.correctnessScoreTotal / nextBucket.attempts : 0;
  nextBucket.lastCategory = validationResult.category;
  nextBucket.lastFeedbackType = validationResult.feedbackType;
  nextBucket.missingConcepts = unique([
    ...nextBucket.missingConcepts,
    ...(validationResult.missingConcepts || [])
  ]);
  nextBucket.misconceptionIds = unique([
    ...nextBucket.misconceptionIds,
    ...(validationResult.misconceptionIds || [])
  ]);

  return nextBucket;
}

function getSkillIds(validationResult) {
  return validationResult.skillIds?.length > 0 ? validationResult.skillIds : ["unmapped_kc"];
}

export function createObservedLearnerState(seedState = {}) {
  return {
    version: "observed_learner_state_v1",
    totalInteractions: seedState.totalInteractions || 0,
    lastInteraction: seedState.lastInteraction || null,
    overall: seedState.overall || createObservedBucket(),
    bySkill: {
      ...(seedState.bySkill || {})
    },
    byQuestion: {
      ...(seedState.byQuestion || {})
    }
  };
}

export function updateObservedLearnerState(seedState = {}, validationResult, metadata = {}) {
  const state = createObservedLearnerState(seedState);
  const skillIds = getSkillIds(validationResult);
  const questionId = validationResult.questionId || metadata.questionId || "unknown_question";

  state.totalInteractions += 1;
  state.overall = updateBucket(state.overall, validationResult);
  state.byQuestion[questionId] = updateBucket(state.byQuestion[questionId], validationResult);

  for (const skillId of skillIds) {
    state.bySkill[skillId] = updateBucket(state.bySkill[skillId], validationResult);
  }

  state.lastInteraction = {
    timestamp: metadata.timestamp || new Date().toISOString(),
    lessonId: validationResult.lessonId || metadata.lessonId || "",
    questionId,
    skillIds,
    category: validationResult.category,
    correctnessScore: getCorrectnessScore(validationResult),
    failedAttemptWeight: getFailureWeight(validationResult),
    feedbackType: validationResult.feedbackType,
    missingConcepts: validationResult.missingConcepts || [],
    misconceptionIds: validationResult.misconceptionIds || []
  };

  return state;
}
