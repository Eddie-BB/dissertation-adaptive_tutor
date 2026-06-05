import { fileURLToPath, pathToFileURL } from 'url';
import { computeAppraisal } from './appraisalEngine.js';
import { createStudentProfile } from './studentProfileFactory.js';
import { createFunctionModelAdapter } from './modelAdapters.js';

function readComponents(result = {}) {
  const scores = result?.componentScores || {};
  return Object.fromEntries(
    ['M1', 'M2', 'M3', 'M4', 'R1', 'R2', 'R3', 'R4'].map(key => [key, scores?.[key]?.value ?? null])
  );
}

function createValidationAdapter(messageCase) {
  return createFunctionModelAdapter(() => ({
    M1: messageCase.visibleHistory.length > 0 ? 0.6 : 0.2,
    M2: messageCase.visibleHistory.length > 0 ? 0.6 : 0.2,
    M3: messageCase.expectedScores?.M3 ?? 0.5,
    M4: messageCase.expectedScores?.M4 ?? 0.5,
    R1: messageCase.expectedScores?.R1 ?? 0.3,
    R2: messageCase.expectedScores?.R2 ?? 0.7,
    R3: messageCase.expectedScores?.R3 ?? 0.5,
    R4: messageCase.expectedScores?.R4 ?? 0.3,
    m1_similarity_list: messageCase.visibleHistory.map((_text, index) => ({
      turn_id: `prior_${index + 1}`,
      sim_i: 0.6,
      reason: 'validation adapter task similarity'
    })),
    m2_similarity_list: messageCase.visibleHistory.map((_text, index) => ({
      turn_id: `prior_${index + 1}`,
      sim_i: 0.6,
      reason: 'validation adapter structure similarity'
    })),
    rationale: {
      M1: 'validation adapter M1 rationale',
      M2: 'validation adapter M2 rationale',
      M3: 'validation adapter M3 rationale',
      M4: 'validation adapter M4 rationale',
      R1: 'validation adapter R1 rationale',
      R2: 'validation adapter R2 rationale',
      R3: 'validation adapter R3 rationale',
      R4: 'validation adapter R4 rationale'
    }
  }), {
    adapter_id: `validation_adapter_${messageCase.id}`,
    mode: 'validation_mock'
  });
}

async function compareMessage(messageCase) {
  const template = createStudentProfile({
    seed: `validation-${messageCase.id}`,
    studentId: 'validation-student'
  });
  const persistentState = {
    ...template.current_state,
    student_id: 'validation-student',
    turn_id: `validation:${messageCase.id}`,
    A_prev: 0.55,
    reward_trace_prev: 0.5,
    student_profile: template.student_profile,
    appraisal_constants: template.appraisal_constants
  };

  const llm = await computeAppraisal(
    messageCase.teacherMessage,
    messageCase.visibleHistory,
    messageCase.turnNumber,
    persistentState,
    {
      step_context: messageCase.stepContext,
      appraisal_scorer_adapter: createValidationAdapter(messageCase)
    }
  );

  const llmComponents = readComponents(llm);

  return {
    message_id: messageCase.id,
    llm: llmComponents,
    aggregates: llm.appraisalLog.aggregates,
    intermediate_values: llm.appraisalLog.intermediate_values,
    history_features: llm.appraisalLog.history_features,
    llm_scorer_type: llm?.appraisalLog?.scorer_type || null,
    fallback_used: llm?.appraisalLog?.fallback_used || null,
    llm_appraisal_failed: Boolean(llm?.appraisalLog?.llm_appraisal_failed)
  };
}

async function main() {
  const messageCases = [
    {
      id: 'generic_repeated_message',
      teacherMessage: 'Work on the next step and explain what you would do next.',
      visibleHistory: [
        'Work on the next step and explain what you would do next.',
        'Work on the next step and explain what you would do next.'
      ],
      turnNumber: 3,
      stepContext: {
        step_id: 'validation-step-1',
        step_title: 'Solve the expression',
        step_body: 'Evaluate the expression carefully.'
      }
    },
    {
      id: 'choice_offering_message',
      teacherMessage: 'Would you rather set up the expression first or estimate what the answer should look like before calculating?',
      visibleHistory: [
        'Let us look at the problem together.',
        'Tell me what seems most confusing.'
      ],
      turnNumber: 3,
      stepContext: {
        step_id: 'validation-step-2',
        step_title: 'Using a formula',
        step_body: 'Substitute the values into the formula.'
      }
    },
    {
      id: 'scaffolded_supportive_message',
      teacherMessage: 'Let us break this into steps. First identify the formula, then substitute the values so you can compute the final answer.',
      visibleHistory: [
        'Take your time and think about the first step.'
      ],
      turnNumber: 2,
      stepContext: {
        step_id: 'validation-step-3',
        step_title: 'Using a formula',
        step_body: 'Substitute the values into the formula.'
      }
    },
    {
      id: 'unclear_directive_message',
      teacherMessage: 'Do it now.',
      visibleHistory: [
        'Calculate the answer.',
        'Write the result.'
      ],
      turnNumber: 3,
      stepContext: {
        step_id: 'validation-step-4',
        step_title: 'Unknown step',
        step_body: 'Solve the problem.'
      }
    }
  ];

  const results = [];
  for (const messageCase of messageCases) {
    results.push(await compareMessage(messageCase));
  }

  console.log(JSON.stringify({
    validation_mode: 'llm_required_appraisal_protocol',
    results
  }, null, 2));
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch(error => {
    console.error('LLM APPRAISAL VALIDATION FAILED');
    console.error(error);
    process.exit(1);
  });
}

export { compareMessage };
