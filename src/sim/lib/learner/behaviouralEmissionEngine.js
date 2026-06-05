import crypto from 'crypto';
import { emitLlmStudentText } from './llmStudentTextEmitter.js';

const BEHAVIOUR_LABELS = [
  'ENGAGED_ATTEMPT',
  'MINIMAL_COMPLIANCE',
  'HELP_SEEKING_CONFUSION',
  'CARELESS_GUESS',
  'OFF_TASK',
  'DISENGAGED_NON_RESPONSE'
];

const BEHAVIOUR_WEIGHTS = {
  ENGAGED_ATTEMPT: { bias: -0.2, A: 2.0, R: 1.0, M: -1.2 },
  MINIMAL_COMPLIANCE: { bias: 0.1, A: 0.8, R: 0.0, M: -0.3 },
  HELP_SEEKING_CONFUSION: { bias: -0.1, A: -0.8, R: -0.4, M: 0.0 },
  CARELESS_GUESS: { bias: -0.2, A: -1.0, R: -0.5, M: 0.8 },
  OFF_TASK: { bias: -0.3, A: -0.6, R: -1.2, M: 1.5 },
  DISENGAGED_NON_RESPONSE: { bias: -1.0, A: -2.5, R: -1.0, M: 0.7 }
};

const DEFAULT_BEHAVIOURAL_CONSTANTS = {
  tau: 0.5,
  max_reasoning_steps: 4,
  max_response_sentences: 4
};

function behaviouralError(message, metadata = {}) {
  const error = new Error(`BehaviouralEmission: ${message}`);
  error.experimenter_debug_log = {
    phase: 'behavioural_emission',
    status: 'terminated',
    explanation: message,
    ...metadata,
    timestamp: new Date().toISOString()
  };
  return error;
}

function requiredUnitNumber(source, key, sourceName) {
  const value = Number(source?.[key]);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw behaviouralError(`missing or invalid ${sourceName}.${key}`);
  }
  return value;
}

function validateHandoff(handoff = {}) {
  if (!handoff.student_id) {
    throw behaviouralError('missing behavioural_handoff.student_id');
  }
  if (!handoff.turn_id) {
    throw behaviouralError('missing behavioural_handoff.turn_id');
  }

  return {
    student_id: handoff.student_id,
    turn_id: handoff.turn_id,
    M_t: requiredUnitNumber(handoff, 'M_t', 'behavioural_handoff'),
    R_t: requiredUnitNumber(handoff, 'R_t', 'behavioural_handoff'),
    A_t: requiredUnitNumber(handoff, 'A_t', 'behavioural_handoff')
  };
}

function roundLogit(value) {
  return Number(value.toFixed(6));
}

function computeBaseLogits(handoff) {
  return Object.fromEntries(BEHAVIOUR_LABELS.map((label) => {
    const weights = BEHAVIOUR_WEIGHTS[label];
    return [
      label,
      roundLogit(weights.bias + weights.A * handoff.A_t + weights.R * handoff.R_t + weights.M * handoff.M_t)
    ];
  }));
}

function applyGates(baseLogits, handoff) {
  const adjusted = { ...baseLogits };
  const gatesFired = [];

  if (handoff.A_t < 0.12) {
    adjusted.DISENGAGED_NON_RESPONSE = roundLogit(adjusted.DISENGAGED_NON_RESPONSE + 2.0);
    gatesFired.push({ gate: 'disengagement', target: 'DISENGAGED_NON_RESPONSE', delta: 2.0 });
  }

  if (handoff.R_t < 0.25 && handoff.M_t > 0.78 && handoff.A_t < 0.50) {
    adjusted.OFF_TASK = roundLogit(adjusted.OFF_TASK + 1.4);
    gatesFired.push({ gate: 'off_task', target: 'OFF_TASK', delta: 1.4 });
  }

  if (handoff.A_t > 0.78 && handoff.R_t > 0.68 && handoff.M_t < 0.35) {
    adjusted.ENGAGED_ATTEMPT = roundLogit(adjusted.ENGAGED_ATTEMPT + 0.7);
    gatesFired.push({ gate: 'high_engagement', target: 'ENGAGED_ATTEMPT', delta: 0.7 });
  }

  if (handoff.A_t >= 0.35 && handoff.A_t <= 0.60 && handoff.R_t < 0.38 && handoff.M_t < 0.60) {
    adjusted.HELP_SEEKING_CONFUSION = roundLogit(adjusted.HELP_SEEKING_CONFUSION + 0.6);
    gatesFired.push({ gate: 'help_seeking', target: 'HELP_SEEKING_CONFUSION', delta: 0.6 });
  }

  return { adjustedLogits: adjusted, gatesFired };
}

function softmax(logits, tau = DEFAULT_BEHAVIOURAL_CONSTANTS.tau) {
  const safeTau = Number(tau);
  if (!Number.isFinite(safeTau) || safeTau <= 0) {
    throw behaviouralError('tau must be a finite positive number');
  }

  const scaled = BEHAVIOUR_LABELS.map((label) => logits[label] / safeTau);
  const max = Math.max(...scaled);
  const exps = scaled.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);

  return Object.fromEntries(BEHAVIOUR_LABELS.map((label, index) => [
    label,
    Number((exps[index] / total).toFixed(6))
  ]));
}

function seededUnit(seedParts = []) {
  const hash = crypto
    .createHash('sha256')
    .update(seedParts.map((part) => String(part ?? '')).join(':'))
    .digest('hex');
  return parseInt(hash.slice(0, 12), 16) / 0xffffffffffff;
}

function sampleBehaviour(probabilities, { rngSeed, studentId, turnId, turnNumber }) {
  const sample = seededUnit([rngSeed, studentId, turnId, turnNumber]);
  let cumulative = 0;

  for (const label of BEHAVIOUR_LABELS) {
    cumulative += probabilities[label];
    if (sample <= cumulative) {
      return { selectedBehaviour: label, sample };
    }
  }

  return { selectedBehaviour: BEHAVIOUR_LABELS[BEHAVIOUR_LABELS.length - 1], sample };
}

async function emitBehaviouralResponse({
  behaviouralHandoff,
  teacherText,
  taskState = null,
  visibleHistory = [],
  turnNumber,
  rngSeed,
  config = {}
} = {}) {
  const handoff = validateHandoff(behaviouralHandoff);
  const constants = {
    ...DEFAULT_BEHAVIOURAL_CONSTANTS,
    ...(config.behavioural_constants || config.behaviouralConstants || {})
  };
  const baseLogits = computeBaseLogits(handoff);
  const { adjustedLogits, gatesFired } = applyGates(baseLogits, handoff);
  const probabilities = softmax(adjustedLogits, constants.tau);
  const { selectedBehaviour, sample } = sampleBehaviour(probabilities, {
    rngSeed,
    studentId: handoff.student_id,
    turnId: handoff.turn_id,
    turnNumber
  });

  const textEmission = await emitLlmStudentText({
    selected_behaviour: selectedBehaviour,
    M_t: handoff.M_t,
    R_t: handoff.R_t,
    A_t: handoff.A_t,
    teacher_text: teacherText,
    visible_history: visibleHistory,
    problem_text: taskState?.problem_text || taskState?.problemText || '',
    step_context: taskState?.step_context || taskState?.stepContext || taskState,
    turn_number: turnNumber,
    turn_id: handoff.turn_id,
    max_response_sentences: constants.max_response_sentences
  }, {
    adapter: config.student_text_adapter,
    student_text_model: config.student_text_model,
    max_response_sentences: constants.max_response_sentences
  });

  const behaviouralLog = {
    behavioural_protocol: 'behavioural_emission_spec_v1',
    behavioural_handoff: handoff,
    constants,
    feature_vector: [1, handoff.A_t, handoff.R_t, handoff.M_t],
    base_logits: baseLogits,
    gates_fired: gatesFired,
    adjusted_logits: adjustedLogits,
    probabilities,
    sampling: {
      rng_seed: rngSeed,
      sample: Number(sample.toFixed(6))
    },
    selected_behaviour: selectedBehaviour,
    generated_text: textEmission.student_text,
    generated_answer: textEmission.student_answer,
    generated_action: textEmission.student_action,
    generated_explanation: textEmission.student_explanation,
    text_emission: {
      student_text_mode: textEmission.student_text_mode,
      llm_student_text_failed: textEmission.llm_student_text_failed,
      fallback_used: textEmission.fallback_used,
      adapter_metadata: textEmission.adapter_metadata
    }
  };

  return {
    student_text: textEmission.student_text,
    student_answer: textEmission.student_answer,
    student_action: textEmission.student_action,
    student_explanation: textEmission.student_explanation,
    selected_behaviour: selectedBehaviour,
    behavioural_log: behaviouralLog,
    behaviouralLog,
    probabilities
  };
}

export {
  BEHAVIOUR_LABELS,
  BEHAVIOUR_WEIGHTS,
  DEFAULT_BEHAVIOURAL_CONSTANTS,
  applyGates,
  computeBaseLogits,
  emitBehaviouralResponse,
  sampleBehaviour,
  softmax,
  validateHandoff
};

export default { emitBehaviouralResponse };
