import {
  aggregateAppraisalComponentScores,
  computeArmStateUpdate
} from '../lib/learner/appraisalEngine.js';
import { scoreAppraisalComponents } from '../lib/learner/appraisalScorers/llmAppraisalScorer.js';

const DEFAULT_TEACHER_ESTIMATE_PROFILE = Object.freeze({
  A_0: 0.68,
  R_0: 0.5,
  lambda: 0.32,
  kappa_i: 0.6,
  kR: 1.0,
  beta_base: 0.18
});

const DEFAULT_TEACHER_ESTIMATE_CONSTANTS = Object.freeze({
  s: 0.2,
  a: 0.5,
  kM_max: 2.0,
  dt: 1.0
});

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function safeNum(value, defaultValue = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : defaultValue;
}

function normalizeVisibleTurn(turn = {}, index = 0) {
  return {
    turn_number: turn.turn_number || turn.turnNumber || index + 1,
    teacher_message: turn.teacher_message || turn.teacherMessage || '',
    student_message: turn.student_message || turn.studentMessage || '',
    teacher_action: turn.teacher_action || turn.teacherAction || '',
    step_id: turn.step_id || turn.stepId || null
  };
}

function getVisibleTeacherTurns(visibleTurnHistory = []) {
  return (Array.isArray(visibleTurnHistory) ? visibleTurnHistory : [])
    .map(normalizeVisibleTurn)
    .filter((turn) => turn.teacher_message);
}

function buildInitialEstimate() {
  return {
    estimated_M_t: 0.2,
    estimated_R_t: DEFAULT_TEACHER_ESTIMATE_PROFILE.R_0,
    estimated_A_t: DEFAULT_TEACHER_ESTIMATE_PROFILE.A_0,
    estimated_reward_trace_t: DEFAULT_TEACHER_ESTIMATE_PROFILE.R_0,
    componentScores: null,
    components: null,
    evidence: ['initial_turn_no_prior_teacher_message'],
    scorer_type: 'initial_visible_state',
    scoring_mechanism: 'none_until_prior_teacher_message_exists',
    visibleInputsUsed: []
  };
}

async function estimateVisibleState({
  visibleTurnHistory = [],
  teacherState = {},
  stepContext = {},
  config = {}
} = {}) {
  const teacherTurns = getVisibleTeacherTurns(visibleTurnHistory);

  if (teacherTurns.length === 0) {
    return buildInitialEstimate();
  }

  const currentTeacherTurn = teacherTurns[teacherTurns.length - 1];
  const priorTeacherTurns = teacherTurns.slice(Math.max(0, teacherTurns.length - 4), -1);
  const scored = await scoreAppraisalComponents({
    teacherMessage: currentTeacherTurn.teacher_message,
    visibleHistory: priorTeacherTurns,
    stepContext,
    previousAppraisalState: {
      A_prev: safeNum(teacherState.estimated_A_prev, DEFAULT_TEACHER_ESTIMATE_PROFILE.A_0),
      reward_trace_prev: safeNum(
        teacherState.estimated_R_trace_prev,
        DEFAULT_TEACHER_ESTIMATE_PROFILE.R_0
      ),
      condition_id: 'state_aware_teacher_visible_estimate'
    },
    config: {
      ...config,
      appraisal_model:
        config.state_aware_appraisal_model ||
        config.stateAwareAppraisalModel ||
        config.appraisal_model ||
        config.student_appraisal_model,
      model_env_key: 'OPENAI_STATE_AWARE_APPRAISAL_MODEL'
    }
  });
  const { M_t, R_t } = aggregateAppraisalComponentScores(scored.componentScores);
  const turnNumber = Math.max(
    1,
    safeNum(currentTeacherTurn.turn_number, teacherTurns.length)
  );
  const armStateUpdate = computeArmStateUpdate({
    M_t,
    R_t,
    turnNumber,
    previousState: {
      A_prev: clamp01(safeNum(teacherState.estimated_A_prev, DEFAULT_TEACHER_ESTIMATE_PROFILE.A_0)),
      reward_trace_prev: clamp01(
        safeNum(teacherState.estimated_R_trace_prev, DEFAULT_TEACHER_ESTIMATE_PROFILE.R_0)
      )
    },
    studentProfile: {
      ...DEFAULT_TEACHER_ESTIMATE_PROFILE,
      ...(config.teacher_estimate_profile || config.teacherEstimateProfile || {})
    },
    constants: {
      ...DEFAULT_TEACHER_ESTIMATE_CONSTANTS,
      ...(config.teacher_estimate_constants || config.teacherEstimateConstants || {})
    }
  });

  return {
    estimated_M_t: M_t,
    estimated_R_t: R_t,
    estimated_A_t: armStateUpdate.A_t,
    estimated_reward_trace_t: armStateUpdate.reward_trace_t,
    componentScores: scored.componentScores,
    components: Object.fromEntries(
      Object.entries(scored.componentScores || {}).map(([key, value]) => [key, value.value])
    ),
    evidence: [
      'student_appraisal_llm_component_scorer',
      'student_appraisal_arm_aggregation',
      'visible_teacher_message_history'
    ],
    scorer_type: scored.scorerType || 'llm',
    scoring_mechanism: 'shared_student_appraisal_scorer_and_arm_aggregation',
    taskSignature: scored.taskSignature || null,
    historyFeatures: scored.historyFeatures || null,
    adapterMetadata: scored.adapterMetadata || null,
    visibleInputsUsed: [
      'teacher_message_history',
      'student_message_history_if_present_in_history',
      'current_step_context',
      'previous_teacher_visible_estimate_state'
    ]
  };
}

function updateStateAwareTeacherState({
  previousState = {},
  selectedAction = null,
  stateEstimate = null
} = {}) {
  const lastTeacherAction = previousState?.lastTeacherAction || null;
  const repeatedActionCount = selectedAction && selectedAction === lastTeacherAction
    ? safeNum(previousState?.repeatedActionCount, 0) + 1
    : (selectedAction ? 1 : 0);

  return {
    estimated_A_prev: clamp01(
      stateEstimate?.estimated_A_t ?? previousState?.estimated_A_prev ?? DEFAULT_TEACHER_ESTIMATE_PROFILE.A_0
    ),
    estimated_R_trace_prev: clamp01(
      stateEstimate?.estimated_reward_trace_t ??
        stateEstimate?.estimated_R_t ??
        previousState?.estimated_R_trace_prev ??
        DEFAULT_TEACHER_ESTIMATE_PROFILE.R_0
    ),
    lastTeacherAction: selectedAction || lastTeacherAction || null,
    repeatedActionCount,
    turnCount: safeNum(previousState?.turnCount, 0) + 1
  };
}

export {
  DEFAULT_TEACHER_ESTIMATE_CONSTANTS,
  DEFAULT_TEACHER_ESTIMATE_PROFILE,
  estimateVisibleState,
  updateStateAwareTeacherState
};

export default {
  estimateVisibleState,
  updateStateAwareTeacherState
};
