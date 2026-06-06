import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { computeAppraisal } from "./appraisalEngine.js";
import { emitBehaviouralResponse } from "./behaviouralEmissionEngine.js";
import { createStudentProfile } from "./studentProfileFactory.js";
import { createExperimentError, isExperimentError } from "../../../server/errors/experimentErrors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STUDENT_PROFILE_DIR = path.join(__dirname, "student_profiles");

function safeFileToken(value) {
  return String(value || "student")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "student";
}

function profilePath(studentId) {
  return path.join(STUDENT_PROFILE_DIR, `${safeFileToken(studentId)}.json`);
}

function validateStudentId(studentId) {
  const value = String(studentId || "").trim();
  if (!value) {
    throw createExperimentError("STUDENT_ID_MISSING");
  }
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value)) {
    throw createExperimentError("STUDENT_ID_INVALID");
  }

  return value;
}

async function ensureProfileDir() {
  await fs.mkdir(STUDENT_PROFILE_DIR, { recursive: true });
}

export async function saveStudentProfile(record) {
  await ensureProfileDir();
  const filePath = profilePath(record.student_id);
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return {
    ...record,
    storage: {
      directory: STUDENT_PROFILE_DIR,
      filePath
    }
  };
}

export async function generateAndStoreStudentProfile(options = {}) {
  return saveStudentProfile(createStudentProfile(options));
}

export async function loadStudentProfile(studentId) {
  const validStudentId = validateStudentId(studentId);
  const filePath = profilePath(validStudentId);
  let raw;

  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw createExperimentError("STUDENT_PROFILE_NOT_FOUND", { cause: error });
    }

    throw createExperimentError("STUDENT_PROFILE_INVALID", { cause: error });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw createExperimentError("STUDENT_PROFILE_INVALID", { cause: error });
  }
}

function getCurrentTurn(record = {}) {
  const value = Number(record.current_turn);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function getTeacherHistory(record = {}) {
  return (Array.isArray(record.appraisal_history) ? record.appraisal_history : [])
    .slice(-3)
    .map((entry) => entry.teacher_text)
    .filter(Boolean);
}

function buildTerminationLog({ record, turnNumber, teacherText, error }) {
  return {
    phase: "student_appraisal",
    status: "terminated",
    student_id: record?.student_id || null,
    turn_number: turnNumber,
    teacher_text: teacherText,
    explanation: error?.message || "Student appraisal terminated.",
    cause: error?.experimenter_debug_log || null,
    timestamp: new Date().toISOString()
  };
}

export function buildAppraisalPersistentState(record, turnNumber) {
  const turn_id = `${record.student_id}:${turnNumber}`;
  return {
    ...record.current_state,
    student_id: record.student_id,
    turn_id,
    condition_id: record.condition_id,
    student_profile: record.student_profile,
    appraisal_constants: record.appraisal_constants
  };
}

export async function resetStudentRuntimeState(studentId) {
  const record = await loadStudentProfile(studentId);
  const resetRecord = {
    ...record,
    current_turn: 0,
    current_state: {
      ...(record.initial_state || {}),
      student_id: record.student_id,
      turn_id: `${record.student_id}:0`,
      condition_id: record.condition_id,
      student_profile: record.student_profile,
      appraisal_constants: record.appraisal_constants
    },
    last_arm_output: null,
    last_behavioural_output: null,
    last_debug_log: null,
    appraisal_history: []
  };

  return saveStudentProfile(resetRecord);
}

export async function applyAppraisalTurn({
  studentId,
  teacherText,
  config = {}
}) {
  const record = await loadStudentProfile(studentId);
  const turnNumber = getCurrentTurn(record) + 1;
  const turn_id = `${record.student_id}:${turnNumber}`;
  const persistentState = buildAppraisalPersistentState(record, turnNumber);
  const teacherHistory = getTeacherHistory(record);

  let appraisal;
  let behaviouralEmission;
  try {
    appraisal = await computeAppraisal(
      teacherText,
      teacherHistory,
      turnNumber,
      persistentState,
      config
    );

    const studentVisibleTaskState = config.exposeHiddenTaskToStudent
      ? config.task_state || config.taskState || config.step_context || config.stepContext || null
      : null;

    behaviouralEmission = await emitBehaviouralResponse({
      behaviouralHandoff: {
        student_id: record.student_id,
        turn_id,
        M_t: appraisal.M_t,
        R_t: appraisal.R_t,
        A_t: appraisal.A_t
      },
      teacherText,
      taskState: studentVisibleTaskState,
      visibleHistory: teacherHistory,
      turnNumber,
      rngSeed: config.rng_seed || config.rngSeed || record.seed,
      config
    });
  } catch (error) {
    if (isExperimentError(error)) {
      throw error;
    }

    const debugLog = buildTerminationLog({ record, turnNumber, teacherText, error });
    const saved = await saveStudentProfile({
      ...record,
      last_debug_log: debugLog,
      appraisal_history: [
        ...(Array.isArray(record.appraisal_history) ? record.appraisal_history : []),
        {
          turn_number: turnNumber,
          teacher_text: teacherText,
          status: "terminated",
          experimenter_debug_log: debugLog
        }
      ]
    });
    const wrapped = new Error(debugLog.explanation);
    wrapped.experimenter_debug_log = debugLog;
    wrapped.student = saved;
    throw wrapped;
  }

  const rewardTrace =
    appraisal.appraisalLog?.intermediate_values?.reward_trace_t ??
    appraisal.persistenceData?.reward_trace_prev;

  const nextRecord = {
    ...record,
    updated_at: new Date().toISOString(),
    current_turn: turnNumber,
    current_state: {
      ...appraisal.persistenceData,
      student_id: record.student_id,
      turn_id,
      condition_id: record.condition_id,
      student_profile: record.student_profile,
      appraisal_constants: record.appraisal_constants
    },
    last_arm_output: {
      student_id: record.student_id,
      turn_id,
      M_t: appraisal.M_t,
      R_t: appraisal.R_t,
      A_t: appraisal.A_t,
      reward_trace_t: rewardTrace
    },
    last_behavioural_output: {
      student_id: record.student_id,
      turn_id,
      selected_behaviour: behaviouralEmission.selected_behaviour,
      student_text: behaviouralEmission.student_text,
      student_answer: behaviouralEmission.student_answer,
      student_action: behaviouralEmission.student_action,
      student_explanation: behaviouralEmission.student_explanation,
      probabilities: behaviouralEmission.probabilities
    },
    appraisal_history: [
      ...(Array.isArray(record.appraisal_history) ? record.appraisal_history : []),
      {
        turn_number: turnNumber,
        teacher_text: teacherText,
        arm_output: {
          M_t: appraisal.M_t,
          R_t: appraisal.R_t,
          A_t: appraisal.A_t,
          reward_trace_t: rewardTrace
        },
        behavioural_emission: behaviouralEmission.behavioural_log,
        student_text: behaviouralEmission.student_text,
        student_answer: behaviouralEmission.student_answer,
        student_action: behaviouralEmission.student_action,
        student_explanation: behaviouralEmission.student_explanation,
        selected_behaviour: behaviouralEmission.selected_behaviour,
        next_input_state: appraisal.persistenceData,
        hidden_appraisal_log: appraisal.appraisalLog
      }
    ],
    last_debug_log: null
  };

  const saved = await saveStudentProfile(nextRecord);

  return {
    student: saved,
    appraisal,
    behavioural_emission: behaviouralEmission,
    mapping_validation: {
      A_t_to_next_A_prev: saved.current_state.A_prev === appraisal.A_t,
      reward_trace_t_to_next_reward_trace_prev:
        saved.current_state.reward_trace_prev === appraisal.persistenceData.reward_trace_prev,
      profile_preserved:
        JSON.stringify(saved.current_state.student_profile) === JSON.stringify(saved.student_profile),
      constants_preserved:
        JSON.stringify(saved.current_state.appraisal_constants) === JSON.stringify(saved.appraisal_constants)
    }
  };
}

export { STUDENT_PROFILE_DIR };

export default {
  STUDENT_PROFILE_DIR,
  applyAppraisalTurn,
  generateAndStoreStudentProfile,
  loadStudentProfile,
  resetStudentRuntimeState,
  saveStudentProfile
};
