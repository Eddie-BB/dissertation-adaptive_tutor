import assert from 'node:assert/strict';
import test from 'node:test';

import { runTutorExperimentSession } from '../src/server/experiments/tutorOrchestrator.js';
import {
  DEFAULT_BEHAVIOURAL_CONSTANTS,
  computeCorrectnessProbability,
  sampleAnswerOutcome
} from '../src/sim/lib/learner/behaviouralEmissionEngine.js';
import { emitLlmStudentText } from '../src/sim/lib/learner/llmStudentTextEmitter.js';
import { generateAndStoreStudentProfile } from '../src/sim/lib/learner/studentProfileStore.js';
import { createTeacher } from '../src/sim/teacher/teacherFactory.js';
import { extractCues } from '../src/sim/teacher/cueExtractor.js';
import { TEACHER_ACTIONS } from '../src/sim/teacher/actions.js';
import { planTutorTurn } from '../src/sim/teacher/tutorTurnPlanner.js';

const APPRAISAL_PAYLOAD = Object.freeze({
  M1: 0.2,
  M2: 0.2,
  M3: 0.3,
  M4: 0.3,
  R1: 0.7,
  R2: 0.7,
  R3: 0.6,
  R4: 0.6,
  m1_similarity_list: [],
  m2_similarity_list: [],
  rationale: {
    M1: 'No strong repetition.',
    M2: 'No strong strategic monotony.',
    M3: 'Moderate pacing burden.',
    M4: 'Moderate task sameness.',
    R1: 'Useful guidance.',
    R2: 'Clear structure.',
    R3: 'Student can respond.',
    R4: 'Support is not punitive.'
  }
});

function createStructuredAdapter(generate, adapterId) {
  return {
    adapter_id: adapterId,
    mode: 'test_mock',
    provider: 'test',
    model: 'test-model',
    async generate(contract) {
      return JSON.stringify(generate(contract));
    }
  };
}

function createTeacherMessageAdapter() {
  return createStructuredAdapter((contract) => ({
    teacher_message: `Teacher action ${contract.selected_teacher_action}: ${contract.current_step.step_title}`
  }), 'mock_teacher_message');
}

function createAppraisalAdapter() {
  return createStructuredAdapter(() => APPRAISAL_PAYLOAD, 'mock_appraisal');
}

function createStudentTextAdapter(text) {
  return createStructuredAdapter(() => ({ student_text: text }), 'mock_student_text');
}

function createInspectingStudentTextAdapter(text, contracts) {
  return createStructuredAdapter((contract) => {
    contracts.push(contract);
    return { student_text: text };
  }, 'mock_student_text_inspecting');
}

test('baseline teacher uses only repeated incorrect count for action sequence', () => {
  const teacher = createTeacher('baseline');
  const cues = extractCues({ studentText: 'I am confused and bored. Help?' });

  const first = teacher.processTurn(cues, {
    progressionContext: { repeatedIncorrectOnCurrentStep: 0 }
  });
  const second = teacher.processTurn(cues, {
    progressionContext: { repeatedIncorrectOnCurrentStep: 1 }
  });
  const third = teacher.processTurn(cues, {
    progressionContext: { repeatedIncorrectOnCurrentStep: 2 }
  });

  assert.equal(first.action, TEACHER_ACTIONS.CONTINUE_STANDARD);
  assert.equal(second.action, TEACHER_ACTIONS.GIVE_HINT);
  assert.equal(third.action, TEACHER_ACTIONS.GIVE_SCAFFOLD);
});

test('enhanced sensitivity keeps choice enabled as an action candidate', async () => {
  const teacher = createTeacher('enhanced_sensitivity');
  const cues = extractCues({
    studentText: 'This is boring, can we change to something else?',
    history: []
  });
  const decision = await teacher.processTurnAsync(cues, {
    stepContext: { canOfferChoice: true },
    progressionContext: { repeatedIncorrectOnCurrentStep: 0 },
    currentTurn: 2
  });

  const choiceCandidate = decision.debug.consideredActions.find(
    (candidate) => candidate.action === TEACHER_ACTIONS.OFFER_CHOICE
  );
  assert.ok(choiceCandidate, 'choice should be considered by enhanced_sensitivity');
  assert.ok(choiceCandidate.score > 0, 'choice should receive a non-zero score when autonomy cues exist');
});

test('enhanced sensitivity preserves validation-category evidence for adaptive scoring', async () => {
  const teacher = createTeacher('enhanced_sensitivity');
  const decision = await teacher.processTurnAsync(
    extractCues({ studentText: 'I think it is dependent.' }),
    {
      stepContext: { canUseScaffold: true },
      progressionContext: { repeatedIncorrectOnCurrentStep: 1 },
      lastTurnOutcome: {
        answer_correct: false,
        category: 'misconception',
        confidence: 'high'
      }
    }
  );

  assert.equal(decision.debug.signals.previousAnswerMisconception, true);
  assert.ok(decision.debug.signals.supportNeed > 0.5);
});

test('ARM-weighted correctness calibration uses configured behaviour priors and weights', () => {
  const handoff = {
    student_id: 'calibration-student',
    turn_id: 'calibration-student:1',
    A_t: 0.6,
    R_t: 0.5,
    M_t: 0.4
  };
  const correctness = computeCorrectnessProbability({
    selectedBehaviour: 'ENGAGED_ATTEMPT',
    handoff,
    constants: DEFAULT_BEHAVIOURAL_CONSTANTS
  });
  const sampled = sampleAnswerOutcome({
    selectedBehaviour: 'ENGAGED_ATTEMPT',
    handoff,
    constants: DEFAULT_BEHAVIOURAL_CONSTANTS,
    rngSeed: 'calibration-seed',
    turnNumber: 1
  });

  assert.equal(correctness.baseCorrectness, 0.65);
  assert.equal(correctness.pCorrect, 0.735);
  assert.equal(sampled.pCorrect, 0.735);
  assert.ok(['correct', 'incorrect'].includes(sampled.intendedAnswerOutcome));
});

test('non-answer behaviours calibrate to no submitted answer outcome', () => {
  const sampled = sampleAnswerOutcome({
    selectedBehaviour: 'OFF_TASK',
    handoff: {
      student_id: 'calibration-student',
      turn_id: 'calibration-student:2',
      A_t: 0.9,
      R_t: 0.9,
      M_t: 0
    },
    constants: DEFAULT_BEHAVIOURAL_CONSTANTS,
    rngSeed: 'calibration-seed',
    turnNumber: 2
  });

  assert.equal(sampled.baseCorrectness, 0);
  assert.equal(sampled.intendedAnswerOutcome, 'no_answer');
});

test('student text contract receives intended answer outcome calibration', async () => {
  const contracts = [];
  const adapter = createInspectingStudentTextAdapter('I think the answer is 5.', contracts);
  const emission = await emitLlmStudentText(
    {
      selected_behaviour: 'ENGAGED_ATTEMPT',
      intended_answer_outcome: 'incorrect',
      correctness_calibration: {
        pCorrect: 0.42,
        intendedAnswerOutcome: 'incorrect'
      },
      teacher_text: 'Solve x + 2 = 7. What is x?'
    },
    { adapter }
  );

  assert.equal(emission.student_text, 'I think the answer is 5.');
  assert.equal(contracts[0].intended_answer_outcome, 'incorrect');
  assert.equal(contracts[0].correctness_calibration.pCorrect, 0.42);
  assert.ok(contracts[0].answer_outcome_rules.some((rule) => rule.includes('plausibly incorrect')));
});

test('tutor turn planner treats praise as feedback while preserving current step prompt', () => {
  const currentStep = {
    stepId: 'problem_05_step_01',
    stepTitle: 'Solve the system by substitution. What is x?',
    answerType: 'arithmetic'
  };
  const previousStep = {
    stepId: 'problem_04_step_01',
    stepTitle: 'Determine whether (8,5) is a solution.'
  };

  const plan = planTutorTurn({
    teacherDecision: {
      action: TEACHER_ACTIONS.GIVE_SPECIFIC_PRAISE
    },
    currentStep,
    taskContext: currentStep,
    previousTurn: {
      step: previousStep,
      studentText: '(8,5) is not a solution.',
      validationResult: {
        isCorrect: true,
        category: 'correct'
      }
    },
    stepAdvanced: true
  });

  assert.equal(plan.selected_policy_action, TEACHER_ACTIONS.GIVE_SPECIFIC_PRAISE);
  assert.equal(plan.instructional_action, TEACHER_ACTIONS.CONTINUE_STANDARD);
  assert.equal(plan.modifier_action, 'praise_previous_response_briefly');
  assert.equal(plan.feedback.type, 'brief_specific_praise');
  assert.equal(plan.must_include_current_problem, true);
  assert.equal(plan.required_content.current_problem_material, currentStep.stepTitle);
  assert.equal(plan.previous_step_id, previousStep.stepId);
  assert.equal(plan.current_step_id, currentStep.stepId);
});

test('state-aware teacher estimates visible state with the prior teacher turn index', async () => {
  const teacher = createTeacher('state_aware', {
    appraisal_scorer_adapter: createAppraisalAdapter()
  });
  const decision = await teacher.processTurnAsync(
    extractCues({ studentText: 'I am not sure.' }),
    {
      visibleTurnHistory: [
        {
          turn_number: 1,
          teacher_message: 'Today we are working on systems. Try the first definition question.',
          student_message: 'I am not sure.',
          teacher_action: TEACHER_ACTIONS.CONTINUE_STANDARD,
          step_id: 'step_1'
        }
      ],
      teacherState: {
        estimated_A_prev: 0.68,
        estimated_R_trace_prev: 0.5,
        turnCount: 1
      },
      stepContext: { step_id: 'step_1', step_title: 'Definition question' },
      progressionContext: { repeatedIncorrectOnCurrentStep: 1 },
      currentTurn: 2
    }
  );

  assert.equal(
    decision.debug.stateEstimate.scoring_mechanism,
    'shared_student_appraisal_scorer_and_arm_aggregation'
  );
  assert.equal(decision.debug.stateEstimate.estimated_M_t, 0.25);
  assert.equal(decision.debug.stateEstimate.estimated_R_t, 0.65);
});

test('mocked tutor experiment runner completes teacher/student turn flow', async () => {
  const student = await generateAndStoreStudentProfile({
    seed: 'teacher-runtime-test',
    studentId: 'teacher-runtime-test-student',
    conditionId: 'state_aware'
  });

  const result = await runTutorExperimentSession({
    studentId: student.student_id,
    conditionId: 'state_aware',
    seed: 'teacher-runtime-test',
    maxTurns: 2,
    teacherMessageAdapter: createTeacherMessageAdapter(),
    learnerRuntimeConfig: {
      appraisal_scorer_adapter: createAppraisalAdapter(),
      student_text_adapter: createStudentTextAdapter('independent system')
    },
    teacherRuntimeConfig: {
      appraisal_scorer_adapter: createAppraisalAdapter()
    }
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.transcript.length, 4);
  assert.equal(result.experimenter_debug_log.turn_logs.length, 2);
  assert.equal(
    result.experimenter_debug_log.turn_logs[1].teacher_decision_debug.stateEstimate.scoring_mechanism,
    'shared_student_appraisal_scorer_and_arm_aggregation'
  );
  assert.equal(result.experimenter_debug_log.turn_logs[1].tutor_turn_plan.must_include_current_problem, true);
});

test('student text generation does not receive hidden lesson task context by default', async () => {
  const student = await generateAndStoreStudentProfile({
    seed: 'student-visibility-test',
    studentId: 'student-visibility-test-student',
    conditionId: 'baseline'
  });
  const studentContracts = [];

  await runTutorExperimentSession({
    studentId: student.student_id,
    conditionId: 'baseline',
    seed: 'student-visibility-test',
    maxTurns: 1,
    teacherMessageAdapter: createTeacherMessageAdapter(),
    learnerRuntimeConfig: {
      appraisal_scorer_adapter: createAppraisalAdapter(),
      student_text_adapter: createInspectingStudentTextAdapter('independent system', studentContracts)
    }
  });

  assert.equal(studentContracts.length, 1);
  assert.equal(studentContracts[0].problem_text, '');
  assert.equal(studentContracts[0].step_context, null);
});
