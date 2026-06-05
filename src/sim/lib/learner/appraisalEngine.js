/**
 * Runtime implementation of appraisal_spec_v4.
 * Component scoring is LLM-required; aggregation and state updates remain
 * deterministic ARM computation.
 */

import { scoreAppraisalComponents as scoreLlmAppraisalComponents } from './appraisalScorers/llmAppraisalScorer.js';

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampUpper(value, max) {
  return value <= max ? value : max;
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function requiredNum(source, key, sourceName) {
  const n = Number(source?.[key]);
  if (!Number.isFinite(n)) {
    throw new Error(`AppraisalEngine: missing or invalid ${sourceName}.${key}`);
  }
  return n;
}

function getComponentValue(componentScores = {}, key) {
  return safeNum(componentScores?.[key]?.value, 0);
}

function aggregateAppraisalComponentScores(componentScores = {}) {
  const M_raw = (
    getComponentValue(componentScores, 'M1')
    + getComponentValue(componentScores, 'M2')
    + getComponentValue(componentScores, 'M3')
    + getComponentValue(componentScores, 'M4')
  ) / 4;
  const R_raw = (
    getComponentValue(componentScores, 'R1')
    + getComponentValue(componentScores, 'R2')
    + getComponentValue(componentScores, 'R3')
    + getComponentValue(componentScores, 'R4')
  ) / 4;

  return {
    M_t: Number(clamp01(M_raw).toFixed(2)),
    R_t: Number(clamp01(R_raw).toFixed(2))
  };
}

function computeArmStateUpdate({
  M_t,
  R_t,
  turnNumber,
  previousState = {},
  studentProfile = {},
  constants = {}
}) {
  const cfg = {
    A_0: requiredNum(studentProfile, 'A_0', 'student_profile'),
    R_0: requiredNum(studentProfile, 'R_0', 'student_profile'),
    lambda: requiredNum(studentProfile, 'lambda', 'student_profile'),
    kappa_i: requiredNum(studentProfile, 'kappa_i', 'student_profile'),
    kR: requiredNum(studentProfile, 'kR', 'student_profile'),
    beta_base: requiredNum(studentProfile, 'beta_base', 'student_profile'),
    s: requiredNum(constants, 's', 'appraisal_constants'),
    a: requiredNum(constants, 'a', 'appraisal_constants'),
    kM_max: requiredNum(constants, 'kM_max', 'appraisal_constants'),
    dt: requiredNum(constants, 'dt', 'appraisal_constants')
  };

  const A_prev = requiredNum(previousState, 'A_prev', 'persistent_state');
  const reward_trace_prev = requiredNum(previousState, 'reward_trace_prev', 'persistent_state');
  const reward_trace_t = clamp01((1 - cfg.lambda) * reward_trace_prev + cfg.lambda * R_t);
  const c_t = clamp01(cfg.s * turnNumber);
  const kM_t = clampUpper(cfg.kappa_i * (1 + cfg.a * c_t), cfg.kM_max);
  const denominator = 1 + cfg.kR * reward_trace_t;
  if (denominator <= 0) {
    throw new Error('AppraisalEngine: denominator guard failed');
  }

  const beta_effective_t = cfg.beta_base * ((1 + kM_t * M_t) / denominator);
  if (beta_effective_t < 0) {
    throw new Error('AppraisalEngine: beta_effective_t guard failed');
  }

  return {
    cfg,
    A_t: Number(clamp01(A_prev * Math.exp(-beta_effective_t * cfg.dt)).toFixed(2)),
    reward_trace_t: Number(reward_trace_t.toFixed(4)),
    c_t: Number(c_t.toFixed(4)),
    kM_t: Number(kM_t.toFixed(4)),
    beta_effective_t: Number(beta_effective_t.toFixed(4))
  };
}

async function computeAppraisal(teacherText, historyTexts = [], turnNumber, persistentState = null, config = {}) {
  if (!teacherText || typeof teacherText !== 'string' || teacherText.trim() === '') {
    throw new Error('AppraisalEngine: teacher_text must be a non-empty string');
  }
  if (!Number.isInteger(turnNumber) || turnNumber < 1) {
    throw new Error('AppraisalEngine: turn number must be an integer >= 1');
  }

  const history = Array.isArray(historyTexts) ? historyTexts.slice(-3) : [];
  const state = persistentState || {};
  const studentProfile = state.student_profile;
  if (!studentProfile || typeof studentProfile !== 'object') {
    throw new Error('AppraisalEngine: missing required persistent_state.student_profile');
  }

  const student_id = state.student_id;
  const turn_id = state.turn_id;
  if (!student_id) {
    throw new Error('AppraisalEngine: missing required persistent_state.student_id');
  }
  if (!turn_id) {
    throw new Error('AppraisalEngine: missing required persistent_state.turn_id');
  }

  const constants = state.appraisal_constants;

  const cfg = {
    A_0: requiredNum(studentProfile, 'A_0', 'student_profile'),
    R_0: requiredNum(studentProfile, 'R_0', 'student_profile'),
    lambda: requiredNum(studentProfile, 'lambda', 'student_profile'),
    kappa_i: requiredNum(studentProfile, 'kappa_i', 'student_profile'),
    kR: requiredNum(studentProfile, 'kR', 'student_profile'),
    beta_base: requiredNum(studentProfile, 'beta_base', 'student_profile'),
    s: requiredNum(constants, 's', 'appraisal_constants'),
    a: requiredNum(constants, 'a', 'appraisal_constants'),
    kM_max: requiredNum(constants, 'kM_max', 'appraisal_constants'),
    dt: requiredNum(constants, 'dt', 'appraisal_constants')
  };

  const A_prev = requiredNum(state, 'A_prev', 'persistent_state');
  const reward_trace_prev = requiredNum(state, 'reward_trace_prev', 'persistent_state');

  if (turnNumber === 1) {
    if (A_prev !== cfg.A_0 || reward_trace_prev !== cfg.R_0) {
      throw new Error(
        'AppraisalEngine: first turn directory state must match student_profile A_0 and R_0'
      );
    }
  }

  const scored = await scoreLlmAppraisalComponents({
    teacherMessage: teacherText,
    visibleHistory: history,
    stepContext: config.step_context || config.stepContext || null,
    previousAppraisalState: {
      A_prev,
      reward_trace_prev,
      student_id,
      turn_id,
      condition_id: state.condition_id || config.condition_id || null
    },
    config
  });

  const componentScores = scored.componentScores || {};
  const { M_t, R_t } = aggregateAppraisalComponentScores(componentScores);
  const armStateUpdate = computeArmStateUpdate({
    M_t,
    R_t,
    turnNumber,
    previousState: { A_prev, reward_trace_prev },
    studentProfile,
    constants
  });

  const appraisalLog = {
    student_id,
    turn_id,
    appraisal_protocol: 'llm_component_scoring_deterministic_arm_v1',
    appraisal_constants: cfg,
    TaskSignature: scored.taskSignature || {},
    scorer_type: scored.scorerType || 'llm',
    llm_appraisal_failed: false,
    fallback_used: null,
    component_scores: componentScores,
    aggregates: { M_t, R_t },
    intermediate_values: {
      reward_trace_t: armStateUpdate.reward_trace_t,
      c_t: armStateUpdate.c_t,
      kM_t: armStateUpdate.kM_t,
      beta_effective_t: armStateUpdate.beta_effective_t,
      A_t: armStateUpdate.A_t
    },
    history_features: scored.historyFeatures || {
      m1_similarity_list: [],
      m2_similarity_list: []
    }
  };

  if (scored.adapterMetadata) {
    appraisalLog.scorer_adapter = scored.adapterMetadata;
  }

  appraisalLog.intermediateValues = appraisalLog.intermediate_values;

  return {
    student_id,
    turn_id,
    M_t,
    R_t,
    A_t: armStateUpdate.A_t,
    componentScores,
    appraisalLog,
    persistenceData: {
      student_id,
      turn_id,
      student_profile: studentProfile,
      appraisal_constants: cfg,
      condition_id: state.condition_id || config.condition_id || null,
      A_prev: armStateUpdate.A_t,
      reward_trace_prev: armStateUpdate.reward_trace_t
    }
  };
}

export {
  aggregateAppraisalComponentScores,
  computeArmStateUpdate,
  computeAppraisal
};

export default {
  aggregateAppraisalComponentScores,
  computeArmStateUpdate,
  computeAppraisal
};
