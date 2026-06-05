import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createOpenAiStructuredJsonAdapter,
  generateStructuredDataWithAdapter
} from '../modelAdapters.js';
import {
  buildTaskSignature,
  clamp01
} from './deterministicAppraisalScorer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APPRAISAL_SPEC_PATH = path.resolve(__dirname, '../appraisal_spec_v4');
const COMPONENT_KEYS = ['M1', 'M2', 'M3', 'M4', 'R1', 'R2', 'R3', 'R4'];

let cachedSpecExcerpt = null;

function loadAppraisalSpecExcerpt() {
  if (cachedSpecExcerpt !== null) {
    return cachedSpecExcerpt;
  }

  try {
    const fullSpec = fs.readFileSync(APPRAISAL_SPEC_PATH, 'utf8');
    const startIndex = fullSpec.indexOf('### Step 2. Component Scoring');
    const endIndex = fullSpec.indexOf('### Step 3. Aggregate Computation');
    cachedSpecExcerpt = startIndex >= 0 && endIndex > startIndex
      ? fullSpec.slice(startIndex, endIndex).trim()
      : fullSpec;
  } catch (_error) {
    cachedSpecExcerpt = '';
  }

  return cachedSpecExcerpt;
}

function buildVisibleHistory(visibleHistory = []) {
  return (Array.isArray(visibleHistory) ? visibleHistory : [])
    .slice(-3)
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          turn_number: index + 1,
          teacher_message: item
        };
      }

      return {
        turn_number: item?.turn_number || index + 1,
        teacher_message: item?.teacher_message || item?.teacherMessage || '',
        student_message: item?.student_message || item?.studentMessage || ''
      };
    });
}

function appraisalScoringError(message, metadata = {}) {
  const error = new Error(`AppraisalEngine: ${message}`);
  error.experimenter_debug_log = {
    phase: 'llm_appraisal_component_scoring',
    status: 'terminated',
    explanation: message,
    scorer_adapter: metadata,
    timestamp: new Date().toISOString()
  };
  return error;
}

function normalizeReason(value, key) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw appraisalScoringError(`LLM appraisal returned empty rationale for ${key}`);
  }
  return trimmed;
}

function normalizeComponentPayload(payload = {}) {
  const rationale = payload?.rationale && typeof payload.rationale === 'object' ? payload.rationale : {};
  const componentScores = {};

  for (const key of COMPONENT_KEYS) {
    const value = Number(payload?.[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw appraisalScoringError(`LLM appraisal returned missing or out-of-range score for ${key}`);
    }

    componentScores[key] = {
      value: Number(clamp01(value).toFixed(2)),
      reason: normalizeReason(rationale[key], key)
    };
  }

  return componentScores;
}

function normalizeSimilarityList(payload = {}, key) {
  const list = Array.isArray(payload?.[key]) ? payload[key] : [];
  return list.map((item, index) => {
    const sim = Number(item?.sim_i);
    if (!Number.isFinite(sim) || sim < 0 || sim > 1) {
      throw appraisalScoringError(`LLM appraisal returned invalid ${key}[${index}].sim_i`);
    }

    return {
      turn_id: item?.turn_id || item?.turn_number || `prior_${index + 1}`,
      sim_i: Number(clamp01(sim).toFixed(2)),
      reason: typeof item?.reason === 'string' ? item.reason : ''
    };
  });
}

function createDefaultLlmScorerAdapter(config = {}) {
  return createOpenAiStructuredJsonAdapter({
    adapter_id: 'student_appraisal_llm',
    model:
      config.state_aware_appraisal_model ||
      config.stateAwareAppraisalModel ||
      config.appraisal_model ||
      config.student_appraisal_model ||
      undefined,
    modelEnvKey: config.model_env_key || config.modelEnvKey || 'OPENAI_APPRAISAL_MODEL',
    maxOutputTokens: 900,
    promptBuilder(contract) {
      const specExcerpt = loadAppraisalSpecExcerpt();
      return {
        system: [
          'You are a bounded appraisal-component scorer for a tutoring simulation.',
          'Use only the visible teacher/student context provided.',
          'Score only M1, M2, M3, M4, R1, R2, R3, and R4 from 0.0 to 1.0.',
          'For M1 and M2, return similarity lists for the provided prior teacher turns only.',
          'If no prior teacher turns are provided, score M1 = 0.2 and M2 = 0.2 with empty similarity lists.',
          'Do not compute M_t, R_t, A_t, reward trace, behaviour, or any hidden state.',
          'Return JSON only.',
          'The scoring rubric below is taken directly from appraisal_spec_v4.',
          specExcerpt
        ].join('\n\n'),
        user: JSON.stringify(contract, null, 2)
      };
    },
    jsonSchema: {
      name: 'appraisal_component_scores',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          M1: { type: 'number' },
          M2: { type: 'number' },
          M3: { type: 'number' },
          M4: { type: 'number' },
          R1: { type: 'number' },
          R2: { type: 'number' },
          R3: { type: 'number' },
          R4: { type: 'number' },
          m1_similarity_list: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                turn_id: { type: 'string' },
                sim_i: { type: 'number' },
                reason: { type: 'string' }
              },
              required: ['turn_id', 'sim_i', 'reason']
            }
          },
          m2_similarity_list: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                turn_id: { type: 'string' },
                sim_i: { type: 'number' },
                reason: { type: 'string' }
              },
              required: ['turn_id', 'sim_i', 'reason']
            }
          },
          rationale: {
            type: 'object',
            additionalProperties: false,
            properties: {
              M1: { type: 'string' },
              M2: { type: 'string' },
              M3: { type: 'string' },
              M4: { type: 'string' },
              R1: { type: 'string' },
              R2: { type: 'string' },
              R3: { type: 'string' },
              R4: { type: 'string' }
            },
            required: ['M1', 'M2', 'M3', 'M4', 'R1', 'R2', 'R3', 'R4']
          }
        },
        required: [
          'M1',
          'M2',
          'M3',
          'M4',
          'R1',
          'R2',
          'R3',
          'R4',
          'm1_similarity_list',
          'm2_similarity_list',
          'rationale'
        ]
      }
    }
  });
}

async function scoreAppraisalComponents({
  teacherMessage,
  visibleHistory = [],
  stepContext = null,
  previousAppraisalState = {},
  config = {}
} = {}) {
  const adapter = config.appraisal_scorer_adapter || createDefaultLlmScorerAdapter(config);
  if (!adapter || typeof adapter.generate !== 'function') {
    throw appraisalScoringError(
      'LLM appraisal adapter unavailable. Configure OPENAI_API_KEY before running appraisal.',
      { adapter_id: null, generation_mode: 'adapter_unavailable' }
    );
  }

  const historyForPrompt = buildVisibleHistory(visibleHistory);
  const stepContextForPrompt = stepContext
    ? {
        step_id: stepContext.step_id || stepContext.stepId || null,
        step_title: stepContext.step_title || stepContext.stepTitle || null,
        step_body: stepContext.step_body || stepContext.stepBody || null,
        problem_id: stepContext.problem_id || stepContext.problemId || null
      }
    : null;
  const contract = {
    task: 'student_appraisal_component_scoring',
    scoring_scope: 'visible_teacher_message_only_plus_limited_visible_history',
    current_teacher_message: teacherMessage,
    visible_history_last_3: historyForPrompt,
    visible_step_context: stepContextForPrompt
  };

  const llmResult = await generateStructuredDataWithAdapter(adapter, contract, {
    fallback_data: null,
    fallback_mode: 'fail_closed',
    metadata: {
      scorer_type: 'llm_appraisal'
    }
  });

  if (llmResult.adapter_metadata?.used_fallback) {
    throw appraisalScoringError(
      `LLM appraisal did not return valid structured scores: ${
        llmResult.adapter_metadata?.error || 'unknown adapter failure'
      }`,
      llmResult.adapter_metadata
    );
  }

  return {
    scorerType: 'llm',
    taskSignature: buildTaskSignature(teacherMessage),
    componentScores: normalizeComponentPayload(llmResult.data),
    historyFeatures: {
      m1_similarity_list: normalizeSimilarityList(llmResult.data, 'm1_similarity_list'),
      m2_similarity_list: normalizeSimilarityList(llmResult.data, 'm2_similarity_list')
    },
    llm_appraisal_failed: false,
    fallback_used: null,
    adapterMetadata: llmResult.adapter_metadata
  };
}

export {
  loadAppraisalSpecExcerpt,
  createDefaultLlmScorerAdapter,
  scoreAppraisalComponents
};

export default { scoreAppraisalComponents };
