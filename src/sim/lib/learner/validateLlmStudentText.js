import { pathToFileURL } from 'url';
import { emitLlmStudentText } from './llmStudentTextEmitter.js';
import { createFunctionModelAdapter } from './modelAdapters.js';

const BEHAVIOUR_LABELS = [
  'ENGAGED_ATTEMPT',
  'MINIMAL_COMPLIANCE',
  'HELP_SEEKING_CONFUSION',
  'CARELESS_GUESS',
  'OFF_TASK',
  'DISENGAGED_NON_RESPONSE'
];

const SAMPLE_INPUT = {
  M_t: 0.35,
  R_t: 0.65,
  A_t: 0.7,
  teacher_text: 'What is 15/5?',
  visible_history: [],
  problem_text: 'Compute 15 divided by 5.',
  step_context: {
    problem_id: 'validation-15-divided-by-5',
    step_id: 'validation-step-1',
    step_title: 'What is 15/5?',
    step_body: '',
    answer_type: 'arithmetic'
  },
  turn_number: 1,
  turn_id: 'validate-llm-student-text:1',
  max_response_sentences: 4
};

function buildFallbackText(label) {
  switch (label) {
    case 'ENGAGED_ATTEMPT':
      return '15 divided by 5 is 3.';
    case 'MINIMAL_COMPLIANCE':
      return '3';
    case 'HELP_SEEKING_CONFUSION':
      return 'Do I divide 15 by 5 to get the answer?';
    case 'CARELESS_GUESS':
      return 'Maybe 15 divided by 5 is 4.';
    case 'OFF_TASK':
      return 'I lost track of the division problem.';
    case 'DISENGAGED_NON_RESPONSE':
      return '...';
    default:
      return 'I am still working on 15 divided by 5.';
  }
}

function createValidationTextAdapter() {
  return createFunctionModelAdapter((contract) => ({
    student_text: buildFallbackText(contract.selected_behaviour)
  }), {
    adapter_id: 'student_text_validation_adapter',
    mode: 'validation_mock'
  });
}

function namesHiddenLabel(text = '', label = '') {
  const normalizedText = String(text).toLowerCase();
  const normalizedLabel = String(label).toLowerCase().replace(/_/g, ' ');
  return normalizedText.includes(normalizedLabel) || normalizedText.includes(String(label).toLowerCase());
}

function interactsWithMath(text = '') {
  return /15|5|3|divide|divided|groups?|times/i.test(text);
}

function asksQuestion(text = '') {
  return /\?/.test(text);
}

function countSentences(text = '') {
  const matches = String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return matches ? matches.filter(sentence => sentence.trim()).length : 0;
}

function validateResponse(label, text, emission) {
  const failures = [];
  const sentenceCount = countSentences(text);

  if (!text) failures.push('empty response');
  if (sentenceCount > 4) failures.push(`too many sentences (${sentenceCount})`);
  if (namesHiddenLabel(text, label)) failures.push('names hidden behaviour label');

  if (['ENGAGED_ATTEMPT', 'MINIMAL_COMPLIANCE', 'CARELESS_GUESS'].includes(label) && !interactsWithMath(text)) {
    failures.push('does not interact with the 15/5 task');
  }

  if (label === 'HELP_SEEKING_CONFUSION' && (!asksQuestion(text) || !interactsWithMath(text))) {
    failures.push('confusion response is not a relevant task question');
  }

  return failures;
}

async function validateAllLabels() {
  const outputs = [];

  for (const label of BEHAVIOUR_LABELS) {
    const emission = await emitLlmStudentText({
      ...SAMPLE_INPUT,
      selected_behaviour: label
    }, {
      adapter: createValidationTextAdapter()
    });
    const failures = validateResponse(label, emission.student_text, emission);

    outputs.push({
      selected_behaviour: label,
      student_text: emission.student_text,
      student_text_mode: emission.student_text_mode,
      llm_student_text_failed: emission.llm_student_text_failed,
      fallback_used: emission.fallback_used,
      validation_passed: failures.length === 0,
      failures
    });
  }

  return outputs;
}

async function main() {
  const outputs = await validateAllLabels();
  console.log('LLM STUDENT TEXT VALIDATION');
  console.log(JSON.stringify(outputs, null, 2));

  const failed = outputs.filter(item => !item.validation_passed);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch(error => {
    console.error('LLM STUDENT TEXT VALIDATION FAILED');
    console.error(error);
    process.exit(1);
  });
}

export { validateAllLabels, validateResponse };
