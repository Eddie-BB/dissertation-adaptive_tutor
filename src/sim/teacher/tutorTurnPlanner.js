import { TEACHER_ACTIONS } from './actions.js';

const MODIFIER_ACTIONS = new Set([
  TEACHER_ACTIONS.OFFER_CHOICE,
  TEACHER_ACTIONS.GIVE_GENERAL_ENCOURAGEMENT,
  TEACHER_ACTIONS.GIVE_SPECIFIC_PRAISE,
  TEACHER_ACTIONS.ADDRESS_FRUSTRATION,
  TEACHER_ACTIONS.SUGGEST_SLOWER_PACE,
  TEACHER_ACTIONS.SUGGEST_BREAK
]);

const SUPPORT_ACTIONS = new Set([
  TEACHER_ACTIONS.GIVE_HINT,
  TEACHER_ACTIONS.GIVE_SCAFFOLD,
  TEACHER_ACTIONS.PROVIDE_WORKED_EXAMPLE,
  TEACHER_ACTIONS.GIVE_BOTTOM_OUT,
  TEACHER_ACTIONS.CALL_DYNAMIC_HINT
]);

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeStep(step = {}) {
  return {
    problem_id: step.problemId || step.problem_id || null,
    step_id: step.stepId || step.id || step.step_id || null,
    step_title: cleanText(step.stepTitle || step.step_title || step.title),
    step_body: cleanText(step.stepBody || step.step_body || step.body),
    choices: Array.isArray(step.choices) ? step.choices : [],
    answer_type: step.answerType || step.answer_type || null
  };
}

function summarizeHint(hint = null) {
  if (!hint) {
    return null;
  }

  return {
    type: hint.type || 'hint',
    title: cleanText(hint.title),
    text: cleanText(hint.text)
  };
}

function getResponseInstruction(step = {}) {
  const answerType = String(step.answerType || step.answer_type || '').toLowerCase();
  if (Array.isArray(step.choices) && step.choices.length > 0) {
    return `Choose one: ${step.choices.join(' or ')}.`;
  }
  if (answerType === 'arithmetic') {
    return 'What is your answer?';
  }
  return 'What do you think?';
}

function getInstructionalMove(action) {
  if (SUPPORT_ACTIONS.has(action)) {
    return action;
  }
  if (action === TEACHER_ACTIONS.REQUEST_CHECKIN || action === TEACHER_ACTIONS.REFRAME_PROMPT_VARIANT) {
    return action;
  }
  return TEACHER_ACTIONS.CONTINUE_STANDARD;
}

function getFeedbackComponent({ action, previousTurn = null, stepAdvanced = false }) {
  if (!previousTurn?.validationResult) {
    return {
      type: 'none',
      grounding: 'none',
      required: false
    };
  }

  const isCorrect = previousTurn.validationResult.isCorrect === true;
  if (isCorrect && action === TEACHER_ACTIONS.GIVE_SPECIFIC_PRAISE) {
    return {
      type: 'brief_specific_praise',
      grounding: 'previous_step_and_previous_student_response_only',
      required: true,
      previous_student_text: cleanText(previousTurn.studentText),
      previous_step: summarizeStep(previousTurn.step),
      validation: {
        isCorrect: true,
        category: previousTurn.validationResult.category || 'correct'
      }
    };
  }

  if (!isCorrect) {
    return {
      type: 'brief_correction_or_acknowledgement',
      grounding: 'previous_validation_only',
      required: SUPPORT_ACTIONS.has(action),
      validation: {
        isCorrect: false,
        category: previousTurn.validationResult.category || 'incorrect'
      }
    };
  }

  return {
    type: 'none',
    grounding: 'none',
    required: false
  };
}

function getModifier(action) {
  if (!MODIFIER_ACTIONS.has(action)) {
    return null;
  }

  const modifierByAction = {
    [TEACHER_ACTIONS.OFFER_CHOICE]: 'offer_choice_briefly',
    [TEACHER_ACTIONS.GIVE_GENERAL_ENCOURAGEMENT]: 'encourage_briefly',
    [TEACHER_ACTIONS.GIVE_SPECIFIC_PRAISE]: 'praise_previous_response_briefly',
    [TEACHER_ACTIONS.ADDRESS_FRUSTRATION]: 'acknowledge_frustration_briefly',
    [TEACHER_ACTIONS.SUGGEST_SLOWER_PACE]: 'slow_pace_briefly',
    [TEACHER_ACTIONS.SUGGEST_BREAK]: 'suggest_short_break_briefly'
  };

  return modifierByAction[action] || null;
}

function buildRequiredContent({ currentStep, taskContext, instructionalMove }) {
  const selectedHint = summarizeHint(taskContext?.selected_hint || taskContext?.selectedHint);
  const includeHint = [
    TEACHER_ACTIONS.GIVE_HINT,
    TEACHER_ACTIONS.GIVE_SCAFFOLD,
    TEACHER_ACTIONS.PROVIDE_WORKED_EXAMPLE,
    TEACHER_ACTIONS.GIVE_BOTTOM_OUT,
    TEACHER_ACTIONS.CALL_DYNAMIC_HINT
  ].includes(instructionalMove);

  return {
    current_problem_material: cleanText(
      currentStep?.stepTitle ||
      currentStep?.step_title ||
      taskContext?.step_title ||
      taskContext?.stepTitle ||
      ''
    ),
    current_step_body: cleanText(
      currentStep?.stepBody ||
      currentStep?.step_body ||
      taskContext?.step_body ||
      taskContext?.stepBody ||
      ''
    ),
    selected_hint: includeHint ? selectedHint : null,
    response_instruction: getResponseInstruction(currentStep || taskContext || {})
  };
}

function createMessageSkeleton(plan) {
  const parts = [];

  if (plan.feedback.required && plan.feedback.type === 'brief_specific_praise') {
    parts.push('Good, that previous answer is correct.');
  } else if (plan.feedback.required && plan.feedback.type === 'brief_correction_or_acknowledgement') {
    parts.push('Not quite yet.');
  }

  if (plan.modifier && plan.modifier !== 'praise_previous_response_briefly') {
    parts.push(plan.modifier.replace(/_/g, ' ') + '.');
  }

  if (plan.required_content.current_problem_material) {
    parts.push(plan.required_content.current_problem_material);
  }
  if (plan.required_content.selected_hint?.text) {
    parts.push(plan.required_content.selected_hint.text);
  }
  if (plan.required_content.response_instruction) {
    parts.push(plan.required_content.response_instruction);
  }

  return parts.join(' ');
}

export function planTutorTurn({
  teacherDecision,
  currentStep,
  taskContext,
  previousTurn = null,
  stepAdvanced = false,
  lessonProgress = null
} = {}) {
  const action = teacherDecision?.action || TEACHER_ACTIONS.CONTINUE_STANDARD;
  const instructionalMove = getInstructionalMove(action);
  const modifier = getModifier(action);
  const expectsStudentResponse = true;
  const requiredContent = buildRequiredContent({
    currentStep,
    taskContext,
    instructionalMove
  });

  const plan = {
    protocol: 'tutor_turn_plan_v1',
    selected_policy_action: action,
    instructional_action: instructionalMove,
    modifier_action: modifier,
    feedback: getFeedbackComponent({ action, previousTurn, stepAdvanced }),
    previous_step_id: previousTurn?.step?.stepId || previousTurn?.step?.id || null,
    current_step: summarizeStep(currentStep || taskContext || {}),
    current_step_id:
      currentStep?.stepId ||
      currentStep?.id ||
      taskContext?.step_id ||
      taskContext?.stepId ||
      null,
    step_advanced: Boolean(stepAdvanced),
    expects_student_response: expectsStudentResponse,
    must_include_current_problem: expectsStudentResponse,
    must_ask_for_response: expectsStudentResponse,
    brevity: {
      max_sentences: lessonProgress?.isInitialTeacherTurn ? 4 : 3,
      avoid_exaggerated_praise: true
    },
    required_content: requiredContent,
    constraints: [
      'Use only the required content and visible history.',
      'If feedback is included, ground it only in the previous step, previous student response, and validation.',
      'Do not praise current-step work before the student attempts the current step.',
      'Do not include hints, scaffold text, bottom-out answers, choices, or break suggestions unless the selected action/plan includes them.',
      'Keep the message brief and avoid repeated or exaggerated praise.'
    ]
  };

  return {
    ...plan,
    message_skeleton: createMessageSkeleton(plan)
  };
}

export default { planTutorTurn };
