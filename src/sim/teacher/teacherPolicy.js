// src/sim/teacherPolicy.js
/**
 * CANONICAL: single teacher decision entrypoint.
 *
 * This file is the only place that emits the final `TeacherDecision.action`.
 * It consumes observable cues plus a declarative condition spec, computes
 * internal policy signals, filters them through condition constraints, and
 * selects one symbolic action from the canonical action vocabulary.
 */

import { TEACHER_ACTIONS, ALL_TEACHER_ACTIONS } from './actions.js';
import { getTeacherSpec } from './teacherSpecs.js';
import { estimateVisibleState, updateStateAwareTeacherState } from './stateEstimator.js';

const DEFAULT_THRESHOLDS = Object.freeze({
  confusion: 0.6,
  disengagement: 0.7,
  off_task: 0.6,
  minimal: 0.65,
  frustration: 0.65,
  progress_low: 0.35,
  progress_high: 0.75,
  encouragement: 0.55,
  choice: 0.6,
  pacing_slow: 0.55,
  remediate: 0.85,
  review: 0.7
});

const DEFAULT_SENSITIVITIES = Object.freeze({
  scaffolding: 1.0,
  pacing: 1.0,
  choice: 1.0,
  encouragement: 1.0,
  affect: 1.0
});

function normalizeCapabilities(stepContext = {}) {
  return {
    canOfferChoice: stepContext.canOfferChoice !== false,
    canUseDynamicHint: stepContext.canUseDynamicHint !== false,
    canUseBottomOut: stepContext.canUseBottomOut !== false,
    canUseScaffold: stepContext.canUseScaffold !== false,
    canSkipOptionalContent: stepContext.canSkipOptionalContent !== false
  };
}

function normalizeConditionSpec({ conditionSpec, conditionId }) {
  if (conditionSpec) {
    return conditionSpec;
  }

  const normalizedConditionId = String(conditionId || '');
  const specIdByCondition = {
    baseline: 'baseline',
    enhanced_sensitivity: 'enhanced_sensitivity',
    state_aware: 'state_aware'
  };
  const specId = specIdByCondition[normalizedConditionId];
  if (!specId) {
    throw new Error(`Unsupported teacher condition: ${conditionId || 'missing'}`);
  }

  return getTeacherSpec(specId);
}

function getScore(map, key) {
  return safeNum(map[key], 0);
}

export function chooseTeacherAction({
  conditionSpec,
  conditionId,
  cues = {},
  history = [],
  stepContext = {},
  context = {}
}) {
  const spec = normalizeConditionSpec({ conditionSpec, conditionId });
  const caps = normalizeCapabilities(stepContext);
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(spec.thresholds || {}) };
  const sensitivities = { ...DEFAULT_SENSITIVITIES, ...(spec.sensitivities || {}) };
  const enabledActions = new Set(spec.enabledActions || ALL_TEACHER_ACTIONS);
  const enabledFeatures = spec.enabledFeatures || {};
  if (spec.id === 'baseline') {
    return selectBaselineTeacherAction({ context, spec });
  }
  if (spec.id === 'state_aware' && !context.stateAwareArmEstimate) {
    throw new Error(
      'State-aware teacher requires stateAwareArmEstimate. Use chooseTeacherActionAsync/processTurnAsync.'
    );
  }
  const visibleStateEstimate = spec.id === 'state_aware' ? context.stateAwareArmEstimate : null;

  const signals = computePolicySignals({ cues, history, context, thresholds, sensitivities });
  const candidates = scoreActionCandidates({
    cues,
    context,
    caps,
    thresholds,
    sensitivities,
    enabledFeatures,
    signals
  });
  const filtered = applyConditionConstraints({
    candidates,
    enabledActions,
    caps,
    enabledFeatures,
    spec,
    signals,
    visibleStateEstimate
  });

  const selected = selectPolicyAction({
    filtered,
    spec,
    context
  });
  const stateUpdate = spec.id === 'state_aware'
    ? updateStateAwareTeacherState({
      previousState: context.teacherState || {},
      selectedAction: selected.action,
      stateEstimate: visibleStateEstimate
    })
    : null;

  return {
    action: selected.action,
    rationale: selected.rationale,
    stateUpdate,
    debug: {
      conditionId: spec.conditionId,
      conditionSpecId: spec.id,
      thresholds,
      sensitivities,
      signals,
      stateEstimate: visibleStateEstimate,
      selectedScore: selected.score,
      enabledActions: Array.from(enabledActions),
      disabledActions: filtered.disabledActions,
      consideredActions: filtered.consideredActions
    }
  };
}

function selectBaselineTeacherAction({ context = {}, spec = {} }) {
  const repeatedIncorrectCount = safeNum(
    context.progressionContext?.repeatedIncorrectOnCurrentStep,
    0
  );
  const hasScaffold = hasScaffoldSupport(context);

  if (repeatedIncorrectCount >= 2) {
    return {
      action: TEACHER_ACTIONS.GIVE_SCAFFOLD,
      rationale: 'Baseline gives scaffold support after two wrong answers on the current problem step.',
      stateUpdate: null,
      debug: {
        conditionId: spec.conditionId,
        conditionSpecId: spec.id,
        signals: {
          repeatedIncorrectCount,
          hasScaffold
        },
        selectedScore: 1,
        enabledActions: spec.enabledActions || [],
        disabledActions: [],
        consideredActions: [
          {
            action: TEACHER_ACTIONS.GIVE_SCAFFOLD,
            score: 1,
            rationale: 'Two wrong answers on the current step.'
          }
        ]
      }
    };
  }

  if (repeatedIncorrectCount >= 1) {
    return {
      action: TEACHER_ACTIONS.GIVE_HINT,
      rationale: 'Baseline gives a problem-dependent hint after one wrong answer on the current problem step.',
      stateUpdate: null,
      debug: {
        conditionId: spec.conditionId,
        conditionSpecId: spec.id,
        signals: {
          repeatedIncorrectCount,
          hasScaffold
        },
        selectedScore: 1,
        enabledActions: spec.enabledActions || [],
        disabledActions: [],
        consideredActions: [
          {
            action: TEACHER_ACTIONS.GIVE_HINT,
            score: 1,
            rationale: 'At least one wrong answer on the current step.'
          }
        ]
      }
    };
  }

  return {
    action: TEACHER_ACTIONS.CONTINUE_STANDARD,
    rationale: 'Baseline continues standard instruction until the student has a wrong answer on the current step.',
    stateUpdate: null,
    debug: {
      conditionId: spec.conditionId,
      conditionSpecId: spec.id,
      signals: {
        repeatedIncorrectCount,
        hasScaffold
      },
      selectedScore: 1,
      enabledActions: spec.enabledActions || [],
      disabledActions: [],
      consideredActions: [
        {
          action: TEACHER_ACTIONS.CONTINUE_STANDARD,
          score: 1,
          rationale: 'No wrong answer has been recorded for the current step.'
        }
      ]
    }
  };
}

export async function chooseTeacherActionAsync({
  conditionSpec,
  conditionId,
  cues = {},
  history = [],
  stepContext = {},
  context = {},
  config = {}
}) {
  const spec = normalizeConditionSpec({ conditionSpec, conditionId });
  const stateAwareArmEstimate = spec.id === 'state_aware'
    ? await estimateVisibleState({
        cues,
        visibleTurnHistory: Array.isArray(context.visibleTurnHistory) ? context.visibleTurnHistory : [],
        teacherState: context.teacherState || {},
        stepContext,
        config
      })
    : null;

  return chooseTeacherAction({
    conditionSpec: spec,
    cues,
    history,
    stepContext,
    context: {
      ...context,
      stateAwareArmEstimate
    }
  });
}

function computePolicySignals({ cues, history, context, thresholds, sensitivities }) {
  const lastOutcome = context.lastTurnOutcome || {};
  const previousAnswerIncorrect = lastOutcome.answer_correct === false;
  const previousAnswerCorrect = lastOutcome.answer_correct === true;
  const previousAnswerPartiallyCorrect = lastOutcome.category === 'partially_correct';
  const previousAnswerMisconception = lastOutcome.category === 'misconception';
  const previousAnswerUnknown = lastOutcome.category === 'unknown';
  const repeatedIncorrectCount = safeNum(context.progressionContext?.repeatedIncorrectOnCurrentStep, 0);

  if (cues.isInitialTurn) {
    return {
      progress: 0.45,
      confusion: 0,
      disengagement: 0,
      offTask: 0,
      frustration: 0,
      engagement: 0.4,
      pacingPressure: 0.15,
      autonomyOpportunity: 0.2,
      supportNeed: 0.12,
      remediateNeed: 0.15,
      encouragementNeed: 0.08 * sensitivities.encouragement,
      praiseOpportunity: 0.18,
      reviewNeed: 0.12,
      selfConstructedProxy: null
    };
  }

  const progress = inferProgress(cues, history);
  const confusion = inferConfusion(cues);
  const disengagement = inferDisengagement(cues);
  const offTask = inferOffTask(cues);
  const frustration = inferFrustration(cues);
  const engagement = inferEngagement(cues, progress, disengagement, offTask);
  const pacingPressure = inferPacingPressure(cues, history, context, progress, confusion);
  const autonomyOpportunity = inferAutonomyOpportunity(cues, history, progress, engagement);
  const supportNeed = clamp01(
    inferSupportNeed(confusion, disengagement, frustration, progress)
    + (previousAnswerIncorrect ? 0.32 : 0)
    + (previousAnswerPartiallyCorrect ? 0.16 : 0)
    + (previousAnswerMisconception ? 0.28 : 0)
    + (previousAnswerUnknown ? 0.12 : 0)
    + repeatedIncorrectCount * 0.12
  );
  const remediateNeed = clamp01(Math.max(supportNeed, pacingPressure));
  const encouragementNeed = clamp01(((1 - progress) * 0.25 + frustration * 0.45 + engagement * 0.2) * sensitivities.encouragement);
  const praiseOpportunity = clamp01(progress * 0.75 + engagement * 0.25 + (previousAnswerCorrect ? 0.28 : 0) - (previousAnswerIncorrect ? 0.2 : 0));
  const reviewNeed = clamp01(
    (1 - progress) * 0.5
    + confusion * 0.3
    + offTask * 0.2
    + (previousAnswerIncorrect ? 0.34 : 0)
    + (previousAnswerPartiallyCorrect ? 0.14 : 0)
    + (previousAnswerMisconception ? 0.28 : 0)
    + (previousAnswerUnknown ? 0.18 : 0)
  );

  return {
    progress,
    confusion,
    disengagement,
    offTask,
    frustration,
    engagement,
    pacingPressure,
    autonomyOpportunity,
    supportNeed,
    remediateNeed,
    encouragementNeed,
    praiseOpportunity,
    reviewNeed,
    previousAnswerCorrect,
    previousAnswerIncorrect,
    previousAnswerPartiallyCorrect,
    previousAnswerMisconception,
    previousAnswerUnknown,
    repeatedIncorrectCount
  };
}

function scoreActionCandidates({ cues, context, caps, thresholds, sensitivities, enabledFeatures, signals }) {
  const candidates = [];
  const stepIndex = safeNum(context.currentStepIndex ?? context.stepIndex, 0);
  const totalSteps = Math.max(safeNum(context.stepContext?.totalSteps ?? context.totalSteps, 1), 1);
  const progressRatio = totalSteps > 0 ? stepIndex / totalSteps : 0;

  candidates.push(candidate(
    TEACHER_ACTIONS.CONTINUE_STANDARD,
    0.1 + signals.engagement * 0.35 + signals.progress * 0.35 - signals.supportNeed * 0.25,
    'No stronger adaptive action qualified; continuing standard instruction.'
  ));

  if (enabledFeatures.choice) {
    const choiceScore = signals.autonomyOpportunity * sensitivities.choice
      + (signals.offTask > thresholds.off_task ? 0.15 : 0)
      + (signals.engagement > thresholds.choice ? 0.1 : 0)
      - signals.supportNeed * 0.2
      - signals.frustration * 0.15
      - signals.disengagement * 0.1;
    candidates.push(candidate(
      TEACHER_ACTIONS.OFFER_CHOICE,
      choiceScore,
      'Choice opportunity detected from engagement and re-engagement cues.'
    ));
  }

  if (enabledFeatures.scaffolding) {
    candidates.push(candidate(
      TEACHER_ACTIONS.GIVE_HINT,
      clamp01(
        signals.supportNeed * 0.75
        + (cues.isHelpSeeking ? 0.12 : 0)
        + (cues.requestsRepetition ? 0.08 : 0)
        + (signals.previousAnswerIncorrect ? 0.28 : 0)
        + (signals.previousAnswerPartiallyCorrect ? 0.14 : 0)
      ) * sensitivities.scaffolding,
      'Support need detected; lightweight hint is appropriate.'
    ));
    candidates.push(candidate(
      TEACHER_ACTIONS.GIVE_SCAFFOLD,
      clamp01(
        signals.supportNeed * 0.95
        + (signals.confusion > thresholds.confusion ? 0.1 : 0)
        + (cues.isHelpSeeking ? 0.18 : 0)
        + (signals.previousAnswerMisconception ? 0.16 : 0)
        + signals.repeatedIncorrectCount * 0.12
      ) * sensitivities.scaffolding,
      'Support need and confusion indicate scaffolded support.'
    ));
    candidates.push(candidate(
      TEACHER_ACTIONS.PROVIDE_WORKED_EXAMPLE,
      clamp01(
        signals.remediateNeed * 0.9
        + signals.confusion * 0.2
        + (cues.isHelpSeeking ? 0.1 : 0)
        + (signals.previousAnswerMisconception ? 0.16 : 0)
      ) * sensitivities.scaffolding,
      'Escalated support suggests a worked example.'
    ));
    candidates.push(candidate(
      TEACHER_ACTIONS.GIVE_BOTTOM_OUT,
      clamp01(signals.remediateNeed * 0.95 + (signals.progress < thresholds.progress_low ? 0.15 : 0)) * sensitivities.scaffolding,
      'Severe difficulty suggests bottom-out support.'
    ));
  }

  if (enabledFeatures.dynamic_hint) {
    candidates.push(candidate(
      TEACHER_ACTIONS.CALL_DYNAMIC_HINT,
      clamp01(
        signals.supportNeed * 0.85
        + signals.confusion * 0.15
        + (cues.isHelpSeeking ? 0.18 : 0)
      ) * sensitivities.scaffolding,
      'Support need suggests dynamic hint generation.'
    ));
  }

  candidates.push(candidate(
    TEACHER_ACTIONS.REQUEST_CHECKIN,
    clamp01(
      signals.disengagement * 0.4
      + signals.confusion * 0.35
      + signals.reviewNeed * 0.2
      + (signals.previousAnswerUnknown ? 0.2 : 0)
    ),
    'A check-in is appropriate to clarify understanding and current state.'
  ));

  candidates.push(candidate(
    TEACHER_ACTIONS.REFRAME_PROMPT_VARIANT,
    clamp01(signals.offTask * 0.5 + signals.autonomyOpportunity * 0.2 + (progressRatio > 0.4 ? 0.1 : 0)),
    'Reframing can vary structure and reduce monotony.'
  ));

  if (enabledFeatures.encouragement) {
    const praiseScore = clamp01(
      signals.praiseOpportunity
      - signals.supportNeed * 0.45
      - signals.confusion * 0.35
      - signals.frustration * 0.45
      - signals.offTask * 0.2
      - signals.disengagement * 0.25
    ) * sensitivities.encouragement;

    candidates.push(candidate(
      TEACHER_ACTIONS.GIVE_GENERAL_ENCOURAGEMENT,
      clamp01(
        signals.encouragementNeed
        + (signals.supportNeed > thresholds.confusion ? 0.05 : 0)
        - signals.offTask * 0.1
      ) * sensitivities.encouragement,
      'Affective support is appropriate to sustain effort.'
    ));
    candidates.push(candidate(
      TEACHER_ACTIONS.GIVE_SPECIFIC_PRAISE,
      praiseScore,
      'Progress and engagement justify specific praise.'
    ));
    candidates.push(candidate(
      TEACHER_ACTIONS.ADDRESS_FRUSTRATION,
      clamp01(signals.frustration * sensitivities.affect + signals.disengagement * 0.2),
      'Frustration cues indicate the need for empathetic support.'
    ));
  }

  if (enabledFeatures.pacing) {
    candidates.push(candidate(
      TEACHER_ACTIONS.SUGGEST_SLOWER_PACE,
      clamp01(signals.pacingPressure * sensitivities.pacing + signals.confusion * 0.15),
      'Pacing pressure suggests slowing down the interaction.'
    ));
    candidates.push(candidate(
      TEACHER_ACTIONS.SUGGEST_BREAK,
      clamp01(signals.disengagement * 0.75 + signals.frustration * 0.35) * sensitivities.pacing,
      'Disengagement and affect cues suggest a break.'
    ));
    candidates.push(candidate(
      TEACHER_ACTIONS.SKIP_OPTIONAL_CONTENT,
      clamp01(signals.remediateNeed * 0.6 + signals.pacingPressure * 0.45),
      'Progression adjustment suggests skipping optional content.'
    ));
  }

  return candidates;
}

function applyConditionConstraints({
  candidates,
  enabledActions,
  caps,
  enabledFeatures,
  spec,
  signals,
  visibleStateEstimate = null
}) {
  const consideredActions = [];
  const disabledActions = [];

  const filteredCandidates = candidates
    .map(item => {
      const reasons = [];
      if (!enabledActions.has(item.action)) reasons.push('disabled_by_condition');
      if (item.action === TEACHER_ACTIONS.OFFER_CHOICE && !caps.canOfferChoice) reasons.push('capability_choice_disabled');
      if (item.action === TEACHER_ACTIONS.CALL_DYNAMIC_HINT && !caps.canUseDynamicHint) reasons.push('capability_dynamic_hint_disabled');
      if (item.action === TEACHER_ACTIONS.GIVE_BOTTOM_OUT && !caps.canUseBottomOut) reasons.push('capability_bottom_out_disabled');
      if ((item.action === TEACHER_ACTIONS.GIVE_SCAFFOLD || item.action === TEACHER_ACTIONS.PROVIDE_WORKED_EXAMPLE) && !caps.canUseScaffold) reasons.push('capability_scaffold_disabled');
      if (item.action === TEACHER_ACTIONS.SKIP_OPTIONAL_CONTENT && !caps.canSkipOptionalContent) reasons.push('capability_skip_disabled');

      if (reasons.length > 0) {
        disabledActions.push({ action: item.action, reasons });
        return null;
      }

      // Soft suppression to prevent overuse of strong responses in light conditions.
      let adjustedScore = item.score;
      if (spec.conditionId === 'baseline' && item.action !== TEACHER_ACTIONS.CONTINUE_STANDARD) {
        adjustedScore *= 0.15;
      }
      if (spec.conditionId === 'enhanced_sensitivity') {
        const escalationPressure = clamp01(
          Math.max(
            signals.supportNeed,
            signals.pacingPressure,
            signals.reviewNeed * 0.85,
            signals.offTask * 0.9,
            signals.confusion * 0.95
          )
        );

        if (item.action === TEACHER_ACTIONS.CONTINUE_STANDARD) {
          adjustedScore *= clamp01(1 - escalationPressure * 0.55);
        }
        if (item.action === TEACHER_ACTIONS.GIVE_SPECIFIC_PRAISE) {
          adjustedScore *= clamp01(1 - escalationPressure * 0.55);
        }
        if (item.action === TEACHER_ACTIONS.OFFER_CHOICE) {
          adjustedScore *= clamp01(1 - escalationPressure * 0.4);
        }
        if ([
          TEACHER_ACTIONS.GIVE_HINT,
          TEACHER_ACTIONS.GIVE_SCAFFOLD,
          TEACHER_ACTIONS.PROVIDE_WORKED_EXAMPLE,
          TEACHER_ACTIONS.GIVE_BOTTOM_OUT,
          TEACHER_ACTIONS.CALL_DYNAMIC_HINT,
          TEACHER_ACTIONS.SUGGEST_SLOWER_PACE,
          TEACHER_ACTIONS.SUGGEST_BREAK,
          TEACHER_ACTIONS.SKIP_OPTIONAL_CONTENT,
          TEACHER_ACTIONS.REFRAME_PROMPT_VARIANT
        ].includes(item.action)) {
          adjustedScore = clamp01(adjustedScore + escalationPressure * 0.28);
        }
      }
      if (spec.conditionId === 'state_aware' && visibleStateEstimate) {
        const monotonyPressure = clamp01(visibleStateEstimate.estimated_M_t);
        const rewardDeficit = clamp01(1 - visibleStateEstimate.estimated_R_t);
        const attentionRisk = clamp01(1 - visibleStateEstimate.estimated_A_t);
        const statePressure = clamp01(Math.max(monotonyPressure, rewardDeficit, attentionRisk));

        if (item.action === TEACHER_ACTIONS.CONTINUE_STANDARD) {
          adjustedScore *= clamp01(1 - statePressure * 0.75);
        }
        if (item.action === TEACHER_ACTIONS.REFRAME_PROMPT_VARIANT) {
          adjustedScore = clamp01(adjustedScore + monotonyPressure * 0.38);
        }
        if (item.action === TEACHER_ACTIONS.OFFER_CHOICE) {
          adjustedScore = clamp01(adjustedScore + monotonyPressure * 0.22 + rewardDeficit * 0.12);
        }
        if (item.action === TEACHER_ACTIONS.REQUEST_CHECKIN) {
          adjustedScore = clamp01(adjustedScore + attentionRisk * 0.32 + rewardDeficit * 0.1);
        }
        if ([
          TEACHER_ACTIONS.GIVE_HINT,
          TEACHER_ACTIONS.GIVE_SCAFFOLD,
          TEACHER_ACTIONS.PROVIDE_WORKED_EXAMPLE,
          TEACHER_ACTIONS.GIVE_BOTTOM_OUT,
          TEACHER_ACTIONS.CALL_DYNAMIC_HINT
        ].includes(item.action)) {
          adjustedScore = clamp01(adjustedScore + rewardDeficit * 0.24 + attentionRisk * 0.08);
        }
        if (item.action === TEACHER_ACTIONS.GIVE_GENERAL_ENCOURAGEMENT) {
          adjustedScore = clamp01(adjustedScore + rewardDeficit * 0.16 + attentionRisk * 0.08);
        }
        if (item.action === TEACHER_ACTIONS.GIVE_SPECIFIC_PRAISE) {
          adjustedScore = clamp01(adjustedScore + rewardDeficit * signals.praiseOpportunity * 0.22);
        }
        if (item.action === TEACHER_ACTIONS.SUGGEST_SLOWER_PACE) {
          adjustedScore = clamp01(adjustedScore + attentionRisk * 0.28 + monotonyPressure * 0.08);
        }
        if (item.action === TEACHER_ACTIONS.SUGGEST_BREAK) {
          adjustedScore = clamp01(adjustedScore + attentionRisk * 0.24);
        }
      }
      if (item.action === TEACHER_ACTIONS.GIVE_BOTTOM_OUT && signals.progress > 0.25) {
        adjustedScore *= 0.5;
      }
      if (item.action === TEACHER_ACTIONS.PROVIDE_WORKED_EXAMPLE && signals.supportNeed < spec.thresholds?.remediate) {
        adjustedScore *= 0.7;
      }

      const normalized = { ...item, score: adjustedScore };
      consideredActions.push({ action: normalized.action, score: normalized.score, rationale: normalized.rationale });
      return normalized;
    })
    .filter(Boolean);

  return { filteredCandidates, disabledActions, consideredActions };
}

function selectPolicyAction({
  filtered,
  spec = {},
  context = {}
} = {}) {
  if (spec.id === 'baseline' && context.lastTurnOutcome?.answer_correct === false) {
    const repeatedIncorrectCount = safeNum(context.progressionContext?.repeatedIncorrectOnCurrentStep, 0);
    const scaffoldCandidate = filtered.filteredCandidates.find(item => item.action === TEACHER_ACTIONS.GIVE_SCAFFOLD);
    if (repeatedIncorrectCount >= 2 && scaffoldCandidate && hasScaffoldSupport(context)) {
      return {
        ...scaffoldCandidate,
        score: Math.max(scaffoldCandidate.score, 1),
        rationale: 'Repeated incorrect attempts; baseline support escalates from hint to scaffold.'
      };
    }

    const hintCandidate = filtered.filteredCandidates.find(item => item.action === TEACHER_ACTIONS.GIVE_HINT);
    if (hintCandidate) {
      return {
        ...hintCandidate,
        score: Math.max(hintCandidate.score, 1),
        rationale: 'Previous step attempt was incorrect; baseline hint support is required.'
      };
    }
  }

  return selectHighestScoringAction(filtered);
}

function hasScaffoldSupport(context = {}) {
  const hints = Array.isArray(context.currentStep?.hints)
    ? context.currentStep.hints
    : [];
  return hints.some(hint => hint?.type === 'scaffold' || Boolean(hint?.scaffold));
}

function selectHighestScoringAction(filtered) {
  const ranked = filtered.filteredCandidates
    .slice()
    .sort((a, b) => b.score - a.score);

  const selected = ranked[0];
  if (!selected) {
    throw new Error('Teacher policy produced no enabled action candidates.');
  }

  return selected;
}

function inferProgress(cues, history) {
  const elaboration = clamp01(safeNum(cues.tokenCount, 0) / 18);
  const antiMinimal = cues.isMinimal ? 0 : 1;
  const antiDisengaged = cues.isDisengaged ? 0 : 1;
  return clamp01(elaboration * 0.4 + antiMinimal * 0.35 + antiDisengaged * 0.25);
}

function inferConfusion(cues) {
  return clamp01(
    (cues.isConfused ? 0.45 : 0)
    + (cues.isHelpSeeking ? 0.35 : 0)
    + safeNum(cues.helpSeekingRateLastK, 0) * 0.2
  );
}

function inferDisengagement(cues) {
  return clamp01(
    (cues.isDisengaged ? 0.6 : 0)
    + (cues.idleGapDetected ? 0.2 : 0)
    + safeNum(cues.disengagedRateLastK, 0) * 0.2
  );
}

function inferOffTask(cues) {
  return clamp01(
    (cues.isOffTask ? 0.55 : 0)
    + safeNum(cues.offTaskRateLastK, 0) * 0.25
    + (safeNum(cues.minimalRateLastK, 0) > 0.5 ? 0.1 : 0)
  );
}

function inferFrustration(cues) {
  return clamp01(
    (cues.isFrustrated ? 0.55 : 0)
    + (cues.isConfused ? 0.15 : 0)
    + (cues.isDisengaged ? 0.1 : 0)
  );
}

function inferEngagement(cues, progress, disengagement, offTask) {
  return clamp01(progress * 0.55 + (cues.hasAnyQuestion ? 0.15 : 0) + (1 - disengagement) * 0.2 + (1 - offTask) * 0.1);
}

function inferPacingPressure(cues, history, context, progress, confusion) {
  const turnsSpent = safeNum(context.currentTurn, 0);
  const stagnation = safeNum(cues.minimalRateLastK, 0) * 0.4 + clamp01(-safeNum(cues.tokenTrendSlopeLastK) / 4) * 0.2;
  return clamp01((1 - progress) * 0.35 + confusion * 0.25 + stagnation + (turnsSpent > 3 ? 0.1 : 0));
}

function inferAutonomyOpportunity(cues, history, progress, engagement) {
  return clamp01(
    engagement * 0.45
    + progress * 0.15
    + (cues.isOffTask ? 0.2 : 0)
    + (cues.isMinimal ? 0.1 : 0)
    + (safeNum(cues.offTaskRateLastK, 0) * 0.1)
  );
}

function inferSupportNeed(confusion, disengagement, frustration, progress) {
  return clamp01(confusion * 0.45 + frustration * 0.2 + disengagement * 0.15 + (1 - progress) * 0.2);
}

function candidate(action, score, rationale) {
  return { action, score: clamp01(score), rationale };
}

function safeNum(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export { TEACHER_ACTIONS };

export default { chooseTeacherAction, chooseTeacherActionAsync, TEACHER_ACTIONS };
