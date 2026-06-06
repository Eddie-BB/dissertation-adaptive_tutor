import {
  createOpenAiStructuredJsonAdapter,
  generateStructuredDataWithAdapter
} from './modelAdapters.js';

const BEHAVIOUR_RULES = {
  ENGAGED_ATTEMPT: [
    'produce a real attempt at the problem',
    'include task-grounded reasoning',
    'put the final submitted answer in student_answer using the same format expected by the task',
    'include a plausible answer where appropriate',
    'write 1-4 sentences'
  ],
  MINIMAL_COMPLIANCE: [
    'write a short response',
    'give an answer or near-answer if possible',
    'put the submitted answer in student_answer if one is given',
    'use little or no reasoning',
    'do not be empty unless genuinely disengaged'
  ],
  HELP_SEEKING_CONFUSION: [
    'express uncertainty about method or concept',
    'ask a relevant question',
    'leave student_answer empty unless the student actually submits a clear answer',
    'reference the current problem'
  ],
  CARELESS_GUESS: [
    'give a quick guess',
    'put the guessed answer in student_answer when a guess is made',
    'use weak or no reasoning',
    'the guess may be wrong or approximate'
  ],
  OFF_TASK: [
    'write a brief distracted or off-task response',
    'leave student_answer empty unless the student still gives a clear answer',
    'you may mention losing focus',
    'still sound like a student, not a generic bot'
  ],
  DISENGAGED_NON_RESPONSE: [
    'write a very short non-response',
    'leave student_answer empty',
    'examples of style: "...", "I don\'t know", "Can we stop?"'
  ]
};

const ACTION_BY_BEHAVIOUR = {
  ENGAGED_ATTEMPT: 'submit_answer',
  MINIMAL_COMPLIANCE: 'submit_answer',
  HELP_SEEKING_CONFUSION: 'ask_for_help',
  CARELESS_GUESS: 'submit_answer',
  OFF_TASK: 'off_task',
  DISENGAGED_NON_RESPONSE: 'no_response'
};

const OUTCOME_RULES = {
  correct: [
    'submit a plausible correct answer if the visible tutor message provides an answerable task',
    'keep the reasoning brief and grounded only in visible text'
  ],
  incorrect: [
    'make a genuine attempt, but the submitted answer should be plausibly incorrect',
    'use a realistic slip, incomplete reasoning, or misconception rather than random nonsense',
    'do not state that the response is intentionally incorrect'
  ],
  no_answer: [
    'do not submit an answer',
    'respond naturally with uncertainty, disengagement, or a request for clarification as appropriate'
  ]
};

function normalizeSentenceLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 4;
  }
  return Math.max(1, Math.min(4, Math.floor(parsed)));
}

function normalizeStudentText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStudentAction(value, selectedBehaviour) {
  const candidate = String(value || '').trim();
  return candidate || ACTION_BY_BEHAVIOUR[selectedBehaviour] || 'submit_answer';
}

function createFallbackStudentPayload(contract = {}) {
  const selectedBehaviour = contract.selected_behaviour || null;
  const action = normalizeStudentAction(null, selectedBehaviour);
  const fallbackTextByAction = {
    ask_for_help: 'I am not sure how to answer this yet. Can you help me with the next step?',
    off_task: 'I am having trouble focusing on this one.',
    no_response: "I don't know."
  };

  return {
    student_text: fallbackTextByAction[action] || 'I am not sure, but I think my answer is unclear.',
    student_answer: '',
    student_action: action,
    student_explanation: ''
  };
}

function normalizeStudentPayload(payload = {}, contract = {}) {
  const fallback = createFallbackStudentPayload(contract);
  const studentText = normalizeStudentText(payload.student_text || payload.display_text || fallback.student_text);
  const selectedBehaviour = contract.selected_behaviour || null;
  const studentAction = normalizeStudentAction(payload.student_action, selectedBehaviour);
  const studentAnswer = normalizeStudentText(payload.student_answer || payload.answer || '');
  const studentExplanation = normalizeStudentText(payload.student_explanation || payload.explanation || '');

  return {
    student_text: studentText,
    student_answer: studentAnswer,
    student_action: studentAction,
    student_explanation: studentExplanation
  };
}

function studentTextError(message, metadata = {}) {
  const error = new Error(`BehaviouralEmission: ${message}`);
  error.experimenter_debug_log = {
    phase: 'llm_student_text_emission',
    status: 'terminated',
    explanation: message,
    text_adapter: metadata,
    timestamp: new Date().toISOString()
  };
  return error;
}

function createLlmStudentTextAdapter(config = {}) {
  return createOpenAiStructuredJsonAdapter({
    adapter_id: 'student_text_llm',
    model: config.student_text_model || config.studentTextModel || undefined,
    modelEnvKey: 'OPENAI_STUDENT_TEXT_MODEL',
    maxOutputTokens: 240,
    promptBuilder(contract) {
      return {
        system: [
          'You are generating the next visible response of a simulated student in a tutoring dialogue.',
          '',
          'You are NOT the tutor.',
          'You are NOT evaluating the answer.',
          'You must write the student\'s spoken/text response and a separate machine-readable answer field.',
          '',
          'The behaviour label has already been selected by the simulator.',
          'You must express that behaviour naturally without naming the label.',
          '',
          'Do not choose or change the behaviour label.',
          'Do not rescore appraisal.',
          'Do not mention hidden variables, logits, probabilities, gates, or simulator internals.',
          'student_text is the natural transcript text.',
          'student_answer is only the final answer being submitted, with no explanation.',
          'student_explanation is a short reason if one is visible in the student_text.',
          'student_action must be one of submit_answer, ask_for_help, express_confusion, off_task, no_response.',
          'If the student is only asking for help, confused, off-task, or not responding, leave student_answer empty.',
          'Return strict JSON only.'
        ].join('\n'),
        user: JSON.stringify(contract, null, 2)
      };
    },
    jsonSchema: {
      name: 'student_text_emission',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          student_text: { type: 'string' },
          student_answer: { type: 'string' },
          student_action: {
            type: 'string',
            enum: ['submit_answer', 'ask_for_help', 'express_confusion', 'off_task', 'no_response']
          },
          student_explanation: { type: 'string' }
        },
        required: ['student_text', 'student_answer', 'student_action', 'student_explanation']
      }
    }
  });
}

function buildStudentTextContract(input = {}) {
  const selectedBehaviour = input.selected_behaviour || input.selectedBehaviour || null;
  const intendedAnswerOutcome = input.intended_answer_outcome || input.intendedAnswerOutcome || null;
  return {
    task: 'student_visible_text_emission',
    selected_behaviour: selectedBehaviour,
    behaviour_generation_rules: BEHAVIOUR_RULES[selectedBehaviour] || [],
    intended_answer_outcome: intendedAnswerOutcome,
    answer_outcome_rules: OUTCOME_RULES[intendedAnswerOutcome] || [],
    correctness_calibration: input.correctness_calibration || input.correctnessCalibration || null,
    hidden_appraisal_values_for_student_generation_only: {
      M_t: input.M_t ?? null,
      R_t: input.R_t ?? null,
      A_t: input.A_t ?? null
    },
    teacher_text: input.teacher_text || '',
    visible_history: Array.isArray(input.visible_history) ? input.visible_history.slice(-4) : [],
    problem_text: input.problem_text || '',
    step_context: input.step_context || null,
    answer_format_guidance: {
      answer_type:
        input.step_context?.answer_type ||
        input.step_context?.answerType ||
        null,
      validation_mode:
        input.step_context?.validation_mode ||
        input.step_context?.validationMode ||
        input.step_context?.validation?.mode ||
        null,
      choices: Array.isArray(input.step_context?.choices) ? input.step_context.choices : []
    },
    turn_number: input.turn_number || 1,
    max_response_sentences: normalizeSentenceLimit(input.max_response_sentences),
    grounding_rules: [
      'Use only the visible teacher input and visible history as the source of task material.',
      'If no question or task is visible in the teacher message, do not answer hidden lesson material; ask what to try next or respond naturally to the visible message.',
      'If the visible task is arithmetic, interact with the numbers directly.',
      'For arithmetic answers, put only the numeric value, fraction, decimal, or LaTeX fraction in student_answer.',
      'For multiple-choice answers, put only the chosen option text in student_answer.',
      'Avoid generic filler such as "I will work through it step by step" unless it includes a concrete task attempt.',
      'Follow intended_answer_outcome for answer correctness while preserving the selected behaviour style.',
      'Do not name the selected behaviour label in the response.'
    ]
  };
}

async function emitLlmStudentText(input = {}, options = {}) {
  const adapter = options.adapter || createLlmStudentTextAdapter(options);
  if (!adapter || typeof adapter.generate !== 'function') {
    throw studentTextError(
      'LLM student text adapter unavailable. Configure OPENAI_API_KEY before behavioural text emission.',
      { adapter_id: null, generation_mode: 'adapter_unavailable' }
    );
  }

  const contract = buildStudentTextContract(input);
  const fallbackPayload = createFallbackStudentPayload(contract);
  const result = await generateStructuredDataWithAdapter(adapter, contract, {
    fallback_data: fallbackPayload,
    fallback_mode: 'fail_closed',
    metadata: {
      turn_id: input.turn_id || null,
      selected_behaviour: contract.selected_behaviour,
      intended_answer_outcome: contract.intended_answer_outcome
    }
  });

  const normalizedPayload = normalizeStudentPayload(result.data, contract);
  if (!normalizedPayload.student_text) {
    throw studentTextError('LLM student text emission did not return usable display text.', result.adapter_metadata);
  }

  return {
    ...normalizedPayload,
    student_text_mode: result.adapter_metadata?.used_fallback ? 'fallback' : 'llm',
    llm_student_text_failed: Boolean(result.adapter_metadata?.used_fallback),
    fallback_used: result.adapter_metadata?.used_fallback
      ? result.adapter_metadata?.error || 'structured_student_text_fallback'
      : null,
    adapter_metadata: result.adapter_metadata,
    contract
  };
}

export {
  BEHAVIOUR_RULES,
  OUTCOME_RULES,
  buildStudentTextContract,
  createLlmStudentTextAdapter,
  createFallbackStudentPayload,
  emitLlmStudentText
};

export default { createLlmStudentTextAdapter, emitLlmStudentText };
