/**
 * CANONICAL: active teacher message rendering bridge in the primary simulation path.
 *
 * This file converts teacher decisions into the visible teacher utterance that
 * the student model appraises.
 */

import {
  createOpenAiStructuredJsonAdapter,
  generateStructuredDataWithAdapter
} from '../lib/learner/modelAdapters.js';

function renderTeacherMessage(teacherDecision, llmOutput, taskContext, metadata = {}) {
  if (!llmOutput || typeof llmOutput !== 'string' || llmOutput.trim().length === 0) {
    return {
      teacher_message: '[Teacher did not respond]',
      teacher_decision: teacherDecision || null,
      context: taskContext,
      metadata: { ...metadata, error: 'empty_llm_output' },
      isValid: false
    };
  }

  return {
    teacher_message: llmOutput.trim(),
    teacher_decision: teacherDecision || null,
    context: {
      problem_id: taskContext.problem_id || taskContext.problemId || null,
      step_id: taskContext.step_id || taskContext.stepId,
      step_title: taskContext.step_title || taskContext.stepTitle,
      available_hints: taskContext.hints ? taskContext.hints.length : 0
    },
    metadata: {
      session_id: metadata.session_id || null,
      turn_number: metadata.turn_number || 1,
      problem_id: taskContext.problem_id || taskContext.problemId || null,
      step_id: taskContext.step_id || taskContext.stepId || null,
      ...metadata
    },
    isValid: true
  };
}

function createTeacherMessageAdapter(config = {}) {
  return createOpenAiStructuredJsonAdapter({
    adapter_id: 'teacher_message_llm',
    model:
      config.teacher_message_model ||
      config.teacherMessageModel ||
      undefined,
    modelEnvKey: 'OPENAI_TEACHER_MESSAGE_MODEL',
    maxOutputTokens: 220,
    promptBuilder(contract) {
      return {
        system: [
          'You generate the visible teacher message in a tutoring simulation.',
          'Use the tutor_turn_plan exactly; do not choose extra actions or lesson content.',
          'Use only the required content, visible history, and provided decision metadata.',
          'Do not mention hidden ARM values, behaviour labels, appraisals, logs, probabilities, or simulator internals.',
          'Keep the message brief: no more than the plan max_sentences.',
          'Avoid exaggerated praise and do not repeat praise statements.',
          'If the plan expects a student response, include the current problem material and a clear response instruction.',
          'Return strict JSON only: {"teacher_message":"..."}'
        ].join('\n'),
        user: JSON.stringify(contract, null, 2)
      };
    },
    jsonSchema: {
      name: 'teacher_message_generation',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          teacher_message: { type: 'string' }
        },
        required: ['teacher_message']
      }
    }
  });
}

function buildTeacherMessageContract({
  teacherDecision,
  taskContext,
  tutorTurnPlan = null,
  visibleTurnHistory = [],
  conditionId = null,
  lessonProgress = null
}) {
  const currentStep = tutorTurnPlan?.current_step || {
    problem_id: taskContext.problem_id || taskContext.problemId || null,
    step_id: taskContext.step_id || taskContext.stepId || null,
    step_title: taskContext.step_title || taskContext.stepTitle || '',
    step_body: taskContext.step_body || taskContext.stepBody || '',
    choices: taskContext.choices || [],
    answer_type: taskContext.answer_type || taskContext.answerType || null
  };

  return {
    task: 'teacher_visible_message_generation',
    condition_id: conditionId || teacherDecision?.debug?.conditionSpecId || null,
    selected_teacher_action: teacherDecision?.action || null,
    tutor_turn_plan: tutorTurnPlan,
    decision_rationale: teacherDecision?.rationale || null,
    support_level_signals: teacherDecision?.debug?.signals || null,
    state_aware_estimate: teacherDecision?.debug?.stateEstimate || null,
    considered_teacher_actions: teacherDecision?.debug?.consideredActions || [],
    current_step: currentStep,
    lesson_progress: lessonProgress,
    visible_turn_history: (Array.isArray(visibleTurnHistory) ? visibleTurnHistory : []).slice(-4),
    rules: [
      lessonProgress?.isInitialTeacherTurn && lessonProgress?.lessonLabel
        ? `Begin the message by introducing the lesson: "${lessonProgress.lessonLabel}".`
        : 'Do not re-introduce the lesson unless this is the first teacher turn.',
      'Instantiate the tutor_turn_plan; selected_teacher_action may be a modifier rather than the whole message.',
      'The message should help the student with the current step only when the plan requires current problem material.',
      'Do not reveal expected answers unless the selected action explicitly calls for bottom-out support.',
      'Do not expose hidden student state, hidden appraisal values, or behaviour labels.',
      'Do not include hints, examples, choices, break suggestions, or praise unless the plan includes that component.'
    ]
  };
}

function normalizeLessonOpening(message, lessonProgress = null) {
  const text = String(message || '').trim();
  const lessonLabel = String(lessonProgress?.lessonLabel || '').trim();

  if (!lessonProgress?.isInitialTeacherTurn || !lessonLabel) {
    return stripMathDelimiters(text);
  }

  const opening = `Today we are working on ${lessonLabel}.`;
  const normalizedText = normalizeOpeningText(text);
  const normalizedLessonLabel = normalizeOpeningText(lessonLabel);
  const alreadyIntroducesLesson =
    normalizedText.startsWith(normalizeOpeningText(opening)) ||
    (
      normalizedText.startsWith('welcome to the lesson on ') &&
      normalizedText.includes(normalizedLessonLabel)
    ) ||
    (
      normalizedText.startsWith('welcome to ') &&
      normalizedText.includes(normalizedLessonLabel)
    );

  if (alreadyIntroducesLesson) {
    return stripMathDelimiters(text);
  }

  return stripMathDelimiters(`${opening} ${text}`);
}

function normalizeOpeningText(value) {
  return stripMathDelimiters(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMathDelimiters(value) {
  return String(value || '')
    .replace(/\$\$([^$]+)\$\$/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\\((.*?)\\\)/g, '$1')
    .replace(/\\\[(.*?)\\\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

async function renderTeacherMessageWithAdapter({
  teacherDecision,
  taskContext,
  tutorTurnPlan = null,
  visibleTurnHistory = [],
  conditionId = null,
  lessonProgress = null,
  adapter = null,
  config = {},
  metadata = {}
} = {}) {
  const activeAdapter = adapter || createTeacherMessageAdapter(config);
  if (!activeAdapter || typeof activeAdapter.generate !== 'function') {
    throw new Error('Teacher message LLM adapter unavailable. Configure OPENAI_API_KEY before running teacher text generation.');
  }

  const contract = buildTeacherMessageContract({
    teacherDecision,
    taskContext,
    tutorTurnPlan,
    visibleTurnHistory,
    conditionId,
    lessonProgress
  });
  const result = await generateStructuredDataWithAdapter(activeAdapter, contract, {
    fallback_data: null,
    fallback_mode: 'fail_closed',
    metadata: {
      generation_task: 'teacher_message_generation',
      condition_id: conditionId || null,
      teacher_action: teacherDecision?.action || null,
      tutor_turn_plan: tutorTurnPlan
    }
  });

  if (result.adapter_metadata?.used_fallback || !result.data?.teacher_message) {
    throw new Error(
      `Teacher message LLM did not return valid text: ${
        result.adapter_metadata?.error || 'unknown adapter failure'
      }`
    );
  }

  const rendered = renderTeacherMessage(
    teacherDecision,
    normalizeLessonOpening(result.data.teacher_message, lessonProgress),
    taskContext,
    {
      ...metadata,
      generation_mode: 'llm_teacher_message',
      adapter_metadata: result.adapter_metadata
    }
  );
  const validation = validateTeacherMessage(rendered, tutorTurnPlan);
  if (!validation.valid) {
    throw new Error(`Teacher message validation failed: ${validation.reason}`);
  }

  return {
    ...rendered,
    contract
  };
}

function validateTeacherMessage(teacherMessage, tutorTurnPlan = null) {
  if (!teacherMessage?.isValid) {
    return { valid: false, reason: 'Message marked invalid by renderer' };
  }
  if (!teacherMessage.teacher_message || teacherMessage.teacher_message.trim().length === 0) {
    return { valid: false, reason: 'Message is empty' };
  }
  if (teacherMessage.teacher_message.length > 2000) {
    return { valid: false, reason: 'Message exceeds reasonable length' };
  }
  if (tutorTurnPlan?.must_include_current_problem) {
    const requiredProblem = stripMathDelimiters(
      tutorTurnPlan.required_content?.current_problem_material || ''
    );
    if (requiredProblem && !containsCoreProblemText(teacherMessage.teacher_message, requiredProblem)) {
      return { valid: false, reason: 'Message omitted active problem material' };
    }
  }
  return { valid: true, reason: 'ok' };
}

function containsCoreProblemText(message, requiredProblem) {
  const normalizedMessage = normalizeOpeningText(message);
  const normalizedProblem = normalizeOpeningText(requiredProblem);
  if (!normalizedProblem) {
    return true;
  }
  if (normalizedMessage.includes(normalizedProblem)) {
    return true;
  }

  const tokens = normalizedProblem.split(' ').filter((token) => token.length > 2);
  if (tokens.length === 0) {
    return true;
  }
  const matched = tokens.filter((token) => normalizedMessage.includes(token)).length;
  return matched / tokens.length >= 0.65;
}

export {
  buildTeacherMessageContract,
  createTeacherMessageAdapter,
  renderTeacherMessage,
  renderTeacherMessageWithAdapter,
  validateTeacherMessage
};
