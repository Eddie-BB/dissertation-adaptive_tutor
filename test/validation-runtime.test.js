import assert from 'node:assert/strict';
import test from 'node:test';

import lesson from '../content/lessons/systems_linear_equations_two_variables.json' with { type: 'json' };
import { validateAnswer } from '../src/lib/validation/answerValidator.js';
import { emitLlmStudentText } from '../src/sim/lib/learner/llmStudentTextEmitter.js';

const steps = lesson.problems.flatMap((problem) =>
  problem.steps.map((step) => ({
    ...step,
    problemId: problem.id
  }))
);

const definitionStep = steps.find((step) => step.expectedAnswers?.includes('independent system'));
const fractionStep = steps.find((step) => step.expectedAnswers?.includes('$$\\frac{4}{3}$$'));

function validate(step, studentResponse) {
  return validateAnswer({
    lessonId: lesson.lesson.lessonId,
    questionId: step.id,
    questionSpec: step,
    studentResponse
  });
}

test('string validation accepts exact correct answer', () => {
  const result = validate(definitionStep, {
    student_text: 'I think it is an independent system.',
    student_answer: 'independent system',
    student_action: 'submit_answer'
  });

  assert.equal(result.isCorrect, true);
  assert.equal(result.validationInputSource, 'structured_answer');
});

test('arithmetic validation accepts spaced fraction', () => {
  const result = validate(fractionStep, {
    student_text: 'My final answer is 4 / 3.',
    student_answer: '4 / 3',
    student_action: 'submit_answer'
  });

  assert.equal(result.isCorrect, true);
  assert.equal(result.method, 'arithmetic_equivalence');
  assert.equal(result.normalisedStudentAnswer, '4/3');
  assert.equal(result.normalisedExpectedAnswer, '4/3');
});

test('arithmetic validation accepts decimal equivalent within tolerance', () => {
  const result = validate(fractionStep, {
    student_text: 'I got about 1.3333333333.',
    student_answer: '1.3333333333',
    student_action: 'submit_answer'
  });

  assert.equal(result.isCorrect, true);
  assert.equal(result.method, 'arithmetic_equivalence');
});

test('arithmetic validation accepts unsimplified equivalent fraction', () => {
  const result = validate(fractionStep, {
    student_text: 'I got 8/6 before simplifying.',
    student_answer: '8/6',
    student_action: 'submit_answer'
  });

  assert.equal(result.isCorrect, true);
  assert.equal(result.normalisedStudentAnswer, '4/3');
});

test('arithmetic validation rejects incorrect answer', () => {
  const result = validate(fractionStep, {
    student_text: 'My answer is 5/3.',
    student_answer: '5/3',
    student_action: 'submit_answer'
  });

  assert.equal(result.isCorrect, false);
  assert.equal(result.category, 'incorrect');
});

test('arithmetic validation treats malformed short answer as unknown', () => {
  const result = validate(fractionStep, {
    student_text: '???',
    student_answer: '???',
    student_action: 'submit_answer'
  });

  assert.equal(result.isCorrect, false);
  assert.equal(result.category, 'unknown');
});

test('arithmetic validation extracts answer embedded in explanatory text', () => {
  const result = validate(fractionStep, {
    student_text: 'I added the equations, so the final answer is 4 / 3.',
    student_action: 'submit_answer'
  });

  assert.equal(result.isCorrect, true);
  assert.equal(result.validationInputSource, 'display_text');
});

test('structured answer is preferred over display text when both are present', () => {
  const result = validate(fractionStep, {
    student_text: 'I accidentally said 5/3 out loud.',
    student_answer: '4/3',
    student_action: 'submit_answer'
  });

  assert.equal(result.isCorrect, true);
  assert.equal(result.validationInputSource, 'structured_answer');
});

test('help-seeking action without structured answer is not treated as correct', () => {
  const result = validate(fractionStep, {
    student_text: 'Is the answer supposed to be 4/3? I need help.',
    student_action: 'ask_for_help'
  });

  assert.equal(result.isCorrect, false);
  assert.equal(result.category, 'unknown');
  assert.equal(result.validationInputSource, 'non_answer_action');
});

test('malformed student text LLM output falls back to structured non-answer payload', async () => {
  const adapter = {
    adapter_id: 'malformed_student_text_adapter',
    mode: 'test_malformed',
    async generate() {
      return 'not json';
    }
  };

  const emission = await emitLlmStudentText(
    {
      selected_behaviour: 'HELP_SEEKING_CONFUSION',
      teacher_text: 'Try the next step.',
      step_context: {
        answer_type: 'arithmetic',
        validation_mode: 'arithmetic_equivalence'
      }
    },
    { adapter }
  );

  assert.equal(emission.student_action, 'ask_for_help');
  assert.equal(emission.student_answer, '');
  assert.equal(emission.student_text_mode, 'fallback');
  assert.equal(emission.llm_student_text_failed, true);
});
