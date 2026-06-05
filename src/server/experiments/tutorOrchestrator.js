import { updateObservedLearnerState } from "../../lib/learner/observedLearnerState.js";
import { validateAnswer } from "../../lib/validation/answerValidator.js";
import { applyAppraisalTurn, resetStudentRuntimeState } from "../../sim/lib/learner/studentProfileStore.js";
import { createTeacher } from "../../sim/teacher/teacherFactory.js";
import { extractCues } from "../../sim/teacher/cueExtractor.js";
import { renderTeacherMessageWithAdapter } from "../../sim/teacher/teacherMessageRenderer.js";
import { getActiveLesson } from "../content/lessonStore.js";
import { createExperimentError } from "../errors/experimentErrors.js";

function clampTurns(value) {
  return Math.min(Math.max(Number(value) || 1, 1), 30);
}

function getLessonStepSequence(lesson) {
  return (lesson?.problems || []).flatMap((problem) =>
    (problem.steps || []).map((step) => ({
      ...step,
      problemId: problem.id,
      problemTitle: problem.title,
      problemBody: problem.body || "",
      lessonId: lesson?.lesson?.lessonId || "",
      lessonLabel: lesson?.lesson?.lessonLabel || "",
      courseName: lesson?.course?.courseName || "",
      stepId: step.id,
      totalSteps: (lesson?.problems || []).reduce(
        (count, item) => count + (item.steps || []).length,
        0
      )
    }))
  );
}

function selectHint(step, progressionContext) {
  const hints = step?.hints || [];
  if (hints.length === 0) {
    return null;
  }

  const hintIndex = Math.min(
    Math.max((Number(progressionContext.repeatedIncorrectOnCurrentStep) || 0) - 1, 0),
    hints.length - 1
  );
  return hints[hintIndex] || hints[0];
}

function buildTaskContext({ step, stepIndex, progressionContext }) {
  const selectedHint = selectHint(step, progressionContext);

  return {
    problemId: step.problemId,
    problem_id: step.problemId,
    problemTitle: step.problemTitle,
    problem_text: [step.problemTitle, step.problemBody].filter(Boolean).join("\n"),
    stepId: step.stepId || step.id,
    step_id: step.stepId || step.id,
    stepTitle: step.stepTitle || "",
    step_title: step.stepTitle || "",
    stepBody: step.stepBody || "",
    step_body: step.stepBody || "",
    answerType: step.answerType || "",
    answer_type: step.answerType || "",
    validationMode: step.validation?.mode || "",
    validation_mode: step.validation?.mode || "",
    choices: step.choices || [],
    hints: step.hints || [],
    selectedHint,
    selected_hint: selectedHint,
    currentStepIndex: stepIndex,
    totalSteps: step.totalSteps || 1,
    canOfferChoice: true,
    canUseDynamicHint: true,
    canUseBottomOut: true,
    canUseScaffold: (step.hints || []).some((hint) => hint.type === "scaffold" || hint.scaffold),
    canSkipOptionalContent: false
  };
}

function getLastStudentText(visibleTurnHistory) {
  return [...visibleTurnHistory].reverse().find((turn) => turn.student_message)?.student_message || "";
}

function buildPublicTeacherMessage({ turn, lesson, step, studentId, teacherMessage }) {
  return {
    id: `turn-${turn}-teacher`,
    turn,
    role: "tutor",
    text: teacherMessage.teacher_message,
    lessonId: lesson.lesson?.lessonId || "",
    questionId: step.stepId || step.id,
    studentId
  };
}

function buildPublicStudentMessage({ turn, lesson, step, studentId, studentText }) {
  return {
    id: `turn-${turn}-student`,
    turn,
    role: "student",
    text: studentText,
    lessonId: lesson.lesson?.lessonId || "",
    questionId: step.stepId || step.id,
    studentId
  };
}

function summarizeLesson(lesson, steps) {
  return {
    lessonId: lesson?.lesson?.lessonId || "",
    lessonLabel: lesson?.lesson?.lessonLabel || "",
    courseName: lesson?.course?.courseName || "",
    problemCount: lesson?.problems?.length || 0,
    stepCount: steps.length,
    compatibleConditions: lesson?.conditionMetadata?.compatibleConditions || []
  };
}

function buildActionDistribution(turnLogs) {
  return turnLogs.reduce((distribution, turnLog) => {
    const action = turnLog.teacher_action || "unknown";
    distribution[action] = (distribution[action] || 0) + 1;
    return distribution;
  }, {});
}

function buildBehaviourDistribution(turnLogs) {
  return turnLogs.reduce((distribution, turnLog) => {
    const behaviour = turnLog.hidden_student_behaviour || "unknown";
    distribution[behaviour] = (distribution[behaviour] || 0) + 1;
    return distribution;
  }, {});
}

function buildAverageArm(turnLogs) {
  if (turnLogs.length === 0) {
    return { A_t: null, R_t: null, M_t: null };
  }

  const totals = turnLogs.reduce(
    (sum, turnLog) => ({
      A_t: sum.A_t + Number(turnLog.hidden_arm?.A_t || 0),
      R_t: sum.R_t + Number(turnLog.hidden_arm?.R_t || 0),
      M_t: sum.M_t + Number(turnLog.hidden_arm?.M_t || 0)
    }),
    { A_t: 0, R_t: 0, M_t: 0 }
  );

  return {
    A_t: Number((totals.A_t / turnLogs.length).toFixed(4)),
    R_t: Number((totals.R_t / turnLogs.length).toFixed(4)),
    M_t: Number((totals.M_t / turnLogs.length).toFixed(4))
  };
}

function buildRunSummary(turnLogs) {
  return {
    totalTurns: turnLogs.length,
    actionDistribution: buildActionDistribution(turnLogs),
    behaviourDistribution: buildBehaviourDistribution(turnLogs),
    averageArm: buildAverageArm(turnLogs),
    engagementTrend: turnLogs.map((turnLog) => ({
      turn: turnLog.turn,
      A_t: turnLog.hidden_arm?.A_t,
      R_t: turnLog.hidden_arm?.R_t,
      M_t: turnLog.hidden_arm?.M_t
    }))
  };
}

function roundMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(4)) : null;
}

function buildStudentTraitSummary(studentRecord = {}) {
  const profile = studentRecord.student_profile || {};
  const definitions = Array.isArray(studentRecord.factor_definitions)
    ? studentRecord.factor_definitions
    : [];

  return definitions.map((factor) => ({
    key: factor.key,
    label: factor.label || factor.key,
    value: roundMetric(profile[factor.key]),
    description: factor.description || "",
    range: factor.range || null
  }));
}

function summarizeArm(arm = null) {
  if (!arm) {
    return { A_t: null, R_t: null, M_t: null };
  }

  return {
    A_t: roundMetric(arm.A_t),
    R_t: roundMetric(arm.R_t),
    M_t: roundMetric(arm.M_t)
  };
}

function summarizeEstimatedArm(stateEstimate = null) {
  if (!stateEstimate) {
    return null;
  }

  return {
    A_t: roundMetric(stateEstimate.estimated_A_t),
    R_t: roundMetric(stateEstimate.estimated_R_t),
    M_t: roundMetric(stateEstimate.estimated_M_t),
    scorerType: stateEstimate.scorer_type || null,
    evidence: stateEstimate.evidence || []
  };
}

function diffArmEstimate(estimatedArm, actualArm) {
  if (!estimatedArm || !actualArm) {
    return null;
  }

  return {
    A_t: estimatedArm.A_t == null || actualArm.A_t == null
      ? null
      : roundMetric(estimatedArm.A_t - actualArm.A_t),
    R_t: estimatedArm.R_t == null || actualArm.R_t == null
      ? null
      : roundMetric(estimatedArm.R_t - actualArm.R_t),
    M_t: estimatedArm.M_t == null || actualArm.M_t == null
      ? null
      : roundMetric(estimatedArm.M_t - actualArm.M_t)
  };
}

function diffArm(currentArm, previousArm) {
  if (!currentArm || !previousArm) {
    return { A_t: null, R_t: null, M_t: null };
  }

  return {
    A_t: currentArm.A_t == null || previousArm.A_t == null
      ? null
      : roundMetric(currentArm.A_t - previousArm.A_t),
    R_t: currentArm.R_t == null || previousArm.R_t == null
      ? null
      : roundMetric(currentArm.R_t - previousArm.R_t),
    M_t: currentArm.M_t == null || previousArm.M_t == null
      ? null
      : roundMetric(currentArm.M_t - previousArm.M_t)
  };
}

function categorizeAttention(value) {
  const attention = Number(value);
  if (!Number.isFinite(attention)) {
    return "unknown";
  }
  if (attention >= 0.7) {
    return "high_attention";
  }
  if (attention >= 0.4) {
    return "moderate_attention";
  }
  return "low_attention";
}

function buildDistribution(values) {
  return values.reduce((distribution, value) => {
    const key = value || "unknown";
    distribution[key] = (distribution[key] || 0) + 1;
    return distribution;
  }, {});
}

function calculateAttentionDeclineRate(turnLogs) {
  if (turnLogs.length < 2) {
    return null;
  }

  const first = Number(turnLogs[0].hidden_arm?.A_t);
  const last = Number(turnLogs[turnLogs.length - 1].hidden_arm?.A_t);
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return null;
  }

  return roundMetric((first - last) / (turnLogs.length - 1));
}

function buildTurnSummaries(turnLogs) {
  return turnLogs.map((turnLog, index) => {
    const actualArm = summarizeArm(turnLog.hidden_arm);
    const previousArm = index > 0 ? summarizeArm(turnLogs[index - 1].hidden_arm) : null;
    const estimatedArm = summarizeEstimatedArm(
      turnLog.teacher_decision_debug?.stateEstimate || null
    );

    return {
      turn: turnLog.turn,
      lessonStep: {
        lessonId: turnLog.lesson_id,
        problemId: turnLog.problem_id,
        stepId: turnLog.step_id,
        stepTitle: turnLog.step_title || ""
      },
      tutor: {
        text: turnLog.public_teacher_message,
        action: turnLog.teacher_action,
        rationale: turnLog.teacher_rationale,
        cues: turnLog.tutor_cues || {},
        estimatedArm,
        estimateVsActualArm: diffArmEstimate(estimatedArm, actualArm)
      },
      validation: {
        isCorrect: turnLog.validation_result?.isCorrect ?? false,
        category: turnLog.validation_result?.category || "unknown",
        confidence: turnLog.validation_result?.confidence || null,
        method: turnLog.validation_result?.method || null,
        incorrectAttemptCount: turnLog.incorrect_attempt_count || 0,
        validationInputSource: turnLog.validation_result?.validationInputSource || null,
        normalizedStudentAnswer: turnLog.validation_result?.normalisedStudentAnswer || null,
        normalizedExpectedAnswer: turnLog.validation_result?.normalisedExpectedAnswer || null
      },
      student: {
        text: turnLog.public_student_message,
        structuredAnswer: turnLog.structured_student_answer,
        action: turnLog.student_action,
        explanation: turnLog.student_explanation,
        behaviourState: turnLog.hidden_student_behaviour,
        arm: actualArm,
        armChangeFromPreviousTurn: diffArm(actualArm, previousArm)
      }
    };
  });
}

function buildSummaryMetrics(turnLogs) {
  const validationResults = turnLogs.map((turnLog) => turnLog.validation_result || {});
  const totalCorrect = validationResults.filter((result) => result.isCorrect).length;
  const totalIncorrect = validationResults.length - totalCorrect;

  return {
    totalCorrectResponses: totalCorrect,
    totalIncorrectResponses: totalIncorrect,
    tutorActionDistribution: buildDistribution(turnLogs.map((turnLog) => turnLog.teacher_action)),
    studentActionDistribution: buildDistribution(turnLogs.map((turnLog) => turnLog.student_action)),
    studentStateDistribution: buildDistribution(
      turnLogs.map((turnLog) => categorizeAttention(turnLog.hidden_arm?.A_t))
    ),
    hiddenBehaviourDistribution: buildDistribution(
      turnLogs.map((turnLog) => turnLog.hidden_student_behaviour)
    ),
    attentionDeclineRate: calculateAttentionDeclineRate(turnLogs),
    finalObservedLearnerState: turnLogs[turnLogs.length - 1]?.observed_learner_state?.overall || null
  };
}

function buildExperimenterOutput({ config, lesson, resetStudent, turnLogs, runId }) {
  const conditionId = config.conditionId;

  return {
    runMetadata: {
      runId,
      status: "complete",
      condition: conditionId,
      turnsCompleted: turnLogs.length,
      seedUsed: config.seed ?? resetStudent?.seed ?? null,
      profileGenerationSeed: resetStudent?.seed ?? null,
      behaviourSamplingSeed: config.seed ?? null,
      studentId: config.studentId,
      studentProfileTraits: buildStudentTraitSummary(resetStudent),
      seedExplanation:
        "In this repo the seed used when generating the student profile deterministically samples profile traits. The run seed is also passed into behavioural sampling, so repeated runs with the same generated profile, run seed, tutor condition, adapters, and turn count should sample the same behaviour path. Experiment flow itself remains driven by validation/progression rather than random branching."
    },
    turnSummaries: buildTurnSummaries(turnLogs),
    summaryMetrics: buildSummaryMetrics(turnLogs),
    lesson: summarizeLesson(lesson, getLessonStepSequence(lesson))
  };
}

export async function runTutorExperimentSession(config = {}) {
  const conditionId = config.conditionId;

  if (!config.studentId) {
    throw createExperimentError("STUDENT_ID_MISSING");
  }
  if (!conditionId) {
    throw createExperimentError("CONDITION_INVALID");
  }

  const lesson = await getActiveLesson();
  const compatibleConditions = lesson?.conditionMetadata?.compatibleConditions || [];
  if (!compatibleConditions.includes(conditionId)) {
    throw createExperimentError("CONDITION_INVALID");
  }

  const steps = getLessonStepSequence(lesson);
  if (steps.length === 0) {
    throw createExperimentError("LESSON_INVALID");
  }

  const resetStudent = await resetStudentRuntimeState(config.studentId);

  const maxTurns = clampTurns(config.maxTurns);
  const teacher = createTeacher(conditionId, config.teacherRuntimeConfig || {});
  const transcript = [];
  const turnLogs = [];
  let observedLearnerState = {};
  let visibleTurnHistory = [];
  let teacherState = {};
  let currentStepIndex = 0;
  let repeatedIncorrectOnCurrentStep = 0;
  let lastTurnOutcome = null;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const step = steps[currentStepIndex] || steps[steps.length - 1];
    const progressionContext = {
      currentStepIndex,
      repeatedIncorrectOnCurrentStep,
      completedStepCount: currentStepIndex,
      totalSteps: steps.length
    };
    const taskContext = buildTaskContext({
      step,
      stepIndex: currentStepIndex,
      progressionContext
    });
    const lastStudentText = getLastStudentText(visibleTurnHistory);
    const cues = {
      ...extractCues({
        studentText: lastStudentText,
        history: visibleTurnHistory.map((item) => ({
          studentText: item.student_message || "",
          timestampMs: item.timestampMs
        })),
        nowMs: config.nowMs
      }),
      isInitialTurn: turn === 1
    };
    const teacherDecision = await teacher.processTurnAsync(cues, {
      history: visibleTurnHistory,
      visibleTurnHistory,
      teacherState,
      stepContext: taskContext,
      currentStep: step,
      currentStepIndex,
      stepIndex: currentStepIndex,
      totalSteps: steps.length,
      currentTurn: turn,
      progressionContext,
      lastTurnOutcome
    });
    teacherState = teacherDecision.stateUpdate || teacherState;

    const teacherMessage = await renderTeacherMessageWithAdapter({
      teacherDecision,
      taskContext,
      visibleTurnHistory,
      conditionId,
      lessonProgress: {
        isInitialTeacherTurn: turn === 1,
        lessonLabel: lesson.lesson?.lessonLabel || "",
        currentStepIndex,
        totalSteps: steps.length,
        repeatedIncorrectOnCurrentStep,
        previousOutcomeCategory: lastTurnOutcome?.category || null
      },
      adapter: config.teacherMessageAdapter || config.teacher_message_adapter || null,
      config: config.teacherMessageConfig || {}
    });
    const publicTeacherMessage = buildPublicTeacherMessage({
      turn,
      lesson,
      step,
      studentId: config.studentId,
      teacherMessage
    });
    transcript.push(publicTeacherMessage);

    const appraisalTurn = await applyAppraisalTurn({
      studentId: config.studentId,
      teacherText: teacherMessage.teacher_message,
      config: {
        ...config.learnerRuntimeConfig,
        condition_id: conditionId,
        rngSeed: config.seed,
        stepContext: taskContext,
        taskState: taskContext
      }
    });
    const studentResponse = appraisalTurn.behavioural_emission || {};
    const studentText = studentResponse.student_text || "";
    const publicStudentMessage = buildPublicStudentMessage({
      turn,
      lesson,
      step,
      studentId: config.studentId,
      studentText
    });
    transcript.push(publicStudentMessage);

    let validationResult;
    try {
      validationResult = validateAnswer({
        lessonId: lesson.lesson?.lessonId || "",
        questionId: step.stepId || step.id,
        studentAnswer: studentText,
        studentResponse,
        questionSpec: step
      });
    } catch (error) {
      throw createExperimentError("VALIDATION_FAILED", { cause: error });
    }
    observedLearnerState = updateObservedLearnerState(observedLearnerState, validationResult, {
      lessonId: lesson.lesson?.lessonId || "",
      questionId: step.stepId || step.id
    });

    const turnLog = {
      turn,
      lesson_id: lesson.lesson?.lessonId || "",
      problem_id: step.problemId,
      step_id: step.stepId || step.id,
      step_title: step.stepTitle || "",
      teacher_condition: conditionId,
      teacher_action: teacherDecision.action,
      teacher_rationale: teacherDecision.rationale,
      tutor_cues: cues,
      teacher_decision_debug: teacherDecision.debug,
      teacher_message_metadata: teacherMessage.metadata,
      public_teacher_message: teacherMessage.teacher_message,
      public_student_message: studentText,
      structured_student_answer: studentResponse.student_answer || "",
      student_action: studentResponse.student_action || null,
      student_explanation: studentResponse.student_explanation || "",
      validation_result: validationResult,
      incorrect_attempt_count: validationResult.isCorrect
        ? repeatedIncorrectOnCurrentStep
        : repeatedIncorrectOnCurrentStep + 1,
      observed_learner_state: observedLearnerState,
      hidden_arm: {
        A_t: appraisalTurn.appraisal?.A_t,
        R_t: appraisalTurn.appraisal?.R_t,
        M_t: appraisalTurn.appraisal?.M_t
      },
      hidden_student_behaviour: appraisalTurn.behavioural_emission?.selected_behaviour,
      hidden_behaviour_probabilities: appraisalTurn.behavioural_emission?.probabilities,
      hidden_appraisal_log: appraisalTurn.appraisal?.appraisalLog,
      hidden_behavioural_log: appraisalTurn.behavioural_emission?.behavioural_log
    };
    turnLogs.push(turnLog);

    visibleTurnHistory = [
      ...visibleTurnHistory,
      {
        turn_number: turn,
        teacher_message: teacherMessage.teacher_message,
        student_message: studentText,
        teacher_action: teacherDecision.action,
        step_id: step.stepId || step.id
      }
    ];

    lastTurnOutcome = {
      answer_correct: validationResult.isCorrect,
      category: validationResult.category,
      confidence: validationResult.confidence
    };

    if (validationResult.isCorrect) {
      currentStepIndex = Math.min(currentStepIndex + 1, steps.length - 1);
      repeatedIncorrectOnCurrentStep = 0;
    } else {
      repeatedIncorrectOnCurrentStep += 1;
    }
  }

  if (transcript.length === 0) {
    throw createExperimentError("EMPTY_EXPERIMENT_RUN");
  }

  const runId = `run-${conditionId}-${config.studentId}-${config.seed ?? "seed"}`;
  const experimenterOutput = buildExperimenterOutput({
    config,
    lesson,
    resetStudent,
    turnLogs,
    runId
  });

  return {
    runId,
    status: "complete",
    config,
    lesson: summarizeLesson(lesson, steps),
    transcript,
    observedLearnerState,
    observed_learner_state: observedLearnerState,
    experimenterOutput,
    experimenter_debug_log: {
      visibility_boundary:
        "teacher receives visible lesson/progress/transcript only; hidden ARM and behaviour are logged for researcher analysis only",
      turn_logs: turnLogs,
      summary: buildRunSummary(turnLogs)
    }
  };
}

export default { runTutorExperimentSession };
