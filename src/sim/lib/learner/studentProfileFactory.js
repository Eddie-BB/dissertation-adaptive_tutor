import crypto from "crypto";

const PROFILE_FACTOR_DEFINITIONS = [
  {
    key: "A_0",
    label: "Baseline attention",
    description: "Initial attention used as A_prev on the first appraisal turn.",
    range: [0.48, 0.88]
  },
  {
    key: "R_0",
    label: "Initial reward trace",
    description: "Starting reward memory used as reward_trace_prev on the first turn.",
    range: [0.32, 0.72]
  },
  {
    key: "lambda",
    label: "Reward update rate",
    description: "How strongly current reward R_t updates the persistent reward trace.",
    range: [0.18, 0.46]
  },
  {
    key: "kappa_i",
    label: "Monotony sensitivity",
    description: "Baseline sensitivity amplified into kM_t as turns progress.",
    range: [0.34, 0.88]
  },
  {
    key: "kR",
    label: "Reward sensitivity",
    description: "How strongly accumulated reward protects attention from decay.",
    range: [0.72, 1.42]
  },
  {
    key: "beta_base",
    label: "Base attention decay",
    description: "Underlying attention decay rate before monotony and reward modulation.",
    range: [0.1, 0.28]
  }
];

const DEFAULT_APPRAISAL_CONSTANTS = {
  s: 0.2,
  a: 0.5,
  kM_max: 2.0,
  dt: 1.0
};

function hashToUnit(seed, key) {
  const hash = crypto.createHash("sha256").update(`${seed}:${key}`).digest("hex");
  return parseInt(hash.slice(0, 12), 16) / 0xffffffffffff;
}

function sampleRange(seed, factor) {
  const [min, max] = factor.range;
  const unit = hashToUnit(seed, factor.key);
  return Number((min + unit * (max - min)).toFixed(4));
}

function normalizeSeed(seed) {
  const value = String(seed ?? "").trim();
  return value || "student-seed";
}

export function getProfileFactorDefinitions() {
  return PROFILE_FACTOR_DEFINITIONS.map((factor) => ({ ...factor, range: [...factor.range] }));
}

export function createStudentProfile({ seed = "student-seed", studentId = null, conditionId = null } = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const student_id =
    studentId || `student-${crypto.createHash("sha1").update(normalizedSeed).digest("hex").slice(0, 10)}`;
  const profile = Object.fromEntries(
    PROFILE_FACTOR_DEFINITIONS.map((factor) => [factor.key, sampleRange(normalizedSeed, factor)])
  );
  const appraisal_constants = { ...DEFAULT_APPRAISAL_CONSTANTS };
  const initial_state = {
    student_id,
    turn_id: `${student_id}:0`,
    condition_id: conditionId,
    A_prev: profile.A_0,
    reward_trace_prev: profile.R_0
  };

  return {
    profile_schema_version: "student_profile_v1",
    student_id,
    seed: normalizedSeed,
    condition_id: conditionId,
    generated_at: new Date().toISOString(),
    current_turn: 0,
    student_profile: profile,
    appraisal_constants,
    factor_definitions: getProfileFactorDefinitions(),
    current_state: {
      ...initial_state,
      student_profile: profile,
      appraisal_constants
    },
    initial_state: {
      ...initial_state,
      student_profile: profile,
      appraisal_constants
    },
    last_arm_output: null,
    last_behavioural_output: null,
    arm_contract: {
      appraisal_input_state: ["A_prev", "reward_trace_prev", "student_profile", "appraisal_constants"],
      appraisal_output_state: ["A_t", "reward_trace_t"],
      next_turn_mapping: {
        A_t: "A_prev",
        reward_trace_t: "reward_trace_prev"
      }
    },
    appraisal_history: []
  };
}

export default { createStudentProfile, getProfileFactorDefinitions };
