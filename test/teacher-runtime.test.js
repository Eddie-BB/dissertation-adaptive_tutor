import assert from 'node:assert/strict';
import test from 'node:test';

import { runTutorExperimentSession } from '../src/server/experiments/tutorOrchestrator.js';
import { generateAndStoreStudentProfile } from '../src/sim/lib/learner/studentProfileStore.js';
import { createTeacher } from '../src/sim/teacher/teacherFactory.js';
import { extractCues } from '../src/sim/teacher/cueExtractor.js';
import { TEACHER_ACTIONS } from '../src/sim/teacher/actions.js';

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
});
