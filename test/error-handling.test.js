import assert from 'node:assert/strict';
import test from 'node:test';

import { validateLessonStructure } from '../src/server/content/lessonStore.js';
import {
  createExperimentError,
  toErrorResponse
} from '../src/server/errors/experimentErrors.js';
import { runTutorExperimentSession } from '../src/server/experiments/tutorOrchestrator.js';
import { generateAndStoreStudentProfile } from '../src/sim/lib/learner/studentProfileStore.js';

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

function createAppraisalAdapter() {
  return createStructuredAdapter(() => APPRAISAL_PAYLOAD, 'mock_appraisal');
}

test('experiment run error normalizes invalid student id for API response', async () => {
  await assert.rejects(
    () => runTutorExperimentSession({
      studentId: '../bad',
      conditionId: 'state_aware',
      maxTurns: 1
    }),
    (error) => {
      const response = toErrorResponse(error);
      assert.equal(response.status, 400);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.errorCode, 'STUDENT_ID_INVALID');
      assert.equal(
        response.body.message,
        'Student ID is invalid. Generate or select a valid student before starting the experiment.'
      );
      assert.equal(response.body.recoverable, true);
      return true;
    }
  );
});

test('experiment run error normalizes missing student profile for API response', async () => {
  await assert.rejects(
    () => runTutorExperimentSession({
      studentId: 'missing-profile-for-error-test',
      conditionId: 'state_aware',
      maxTurns: 1
    }),
    (error) => {
      const response = toErrorResponse(error);
      assert.equal(response.status, 404);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.errorCode, 'STUDENT_PROFILE_NOT_FOUND');
      assert.equal(
        response.body.message,
        'Student profile not found. Generate or select a student before starting the experiment.'
      );
      assert.equal(response.body.recoverable, true);
      return true;
    }
  );
});

test('lesson structure validation raises experimenter-facing invalid lesson error', () => {
  assert.throws(
    () => validateLessonStructure({ lesson: { lessonId: 'bad', lessonLabel: 'Bad lesson' }, problems: [] }),
    {
      name: 'ExperimentError',
      errorCode: 'LESSON_INVALID',
      message: 'The selected lesson is invalid or incomplete.'
    }
  );
});

test('missing lesson file errors normalize to structured API response', () => {
  const response = toErrorResponse({ code: 'ENOENT' }, 'LESSON_FILE_NOT_FOUND');

  assert.equal(response.status, 500);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.errorCode, 'LESSON_FILE_NOT_FOUND');
  assert.equal(response.body.message, 'Lesson file could not be loaded.');
});

test('malformed condition response becomes tutor response error', async () => {
  const student = await generateAndStoreStudentProfile({
    seed: 'error-handling-tutor',
    studentId: 'error-handling-tutor-student',
    conditionId: 'state_aware'
  });

  await assert.rejects(
    () => runTutorExperimentSession({
      studentId: student.student_id,
      conditionId: 'state_aware',
      seed: 'error-handling-tutor',
      maxTurns: 1,
      teacherMessageAdapter: {
        adapter_id: 'bad_teacher_message',
        mode: 'test_malformed',
        async generate() {
          return 'not json';
        }
      },
      learnerRuntimeConfig: {
        appraisal_scorer_adapter: createAppraisalAdapter(),
        student_text_adapter: createStructuredAdapter(() => ({
          student_text: 'independent system',
          student_answer: 'independent system',
          student_action: 'submit_answer',
          student_explanation: ''
        }), 'mock_student_text')
      },
      teacherRuntimeConfig: {
        appraisal_scorer_adapter: createAppraisalAdapter()
      }
    }),
    (error) => {
      const response = toErrorResponse(error);
      assert.equal(response.body.errorCode, 'TUTOR_RESPONSE_INVALID');
      assert.equal(response.body.message, 'The tutor response could not be processed.');
      return true;
    }
  );
});

test('validation failures normalize to validation error response', () => {
  const response = toErrorResponse(createExperimentError('VALIDATION_FAILED'));

  assert.equal(response.status, 500);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.errorCode, 'VALIDATION_FAILED');
  assert.equal(response.body.message, 'Validation failed for this response. Check the lesson answer format.');
});

test('unavailable model adapter normalizes to environment guidance', () => {
  const response = toErrorResponse(new Error('Teacher message LLM adapter unavailable. Configure OPENAI_API_KEY.'));

  assert.equal(response.status, 503);
  assert.equal(response.body.errorCode, 'MODEL_ADAPTER_UNAVAILABLE');
  assert.equal(
    response.body.message,
    'The model adapter is unavailable. Check your environment settings or configure a valid adapter.'
  );
});
