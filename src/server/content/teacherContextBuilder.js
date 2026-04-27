import { getLessonById, getProblemById, getStepByIndex } from "./lessonTemplateStore";

function normalizeStudentProgress(stepIndex, studentProgress = {}) {
  return {
    currentStepIndex: stepIndex,
    attemptsOnCurrentStep: Number(studentProgress.attemptsOnCurrentStep) || 0,
    previousIncorrectAnswers: Array.isArray(studentProgress.previousIncorrectAnswers)
      ? studentProgress.previousIncorrectAnswers
      : [],
    visibleStudentHistory: Array.isArray(studentProgress.visibleStudentHistory)
      ? studentProgress.visibleStudentHistory
      : []
  };
}

function buildDebugMetadata(step) {
  return {
    expectedAnswers: step.expectedAnswers || [],
    validation: step.validation || {},
    bkt: Object.fromEntries(
      (step.knowledgeComponents || []).map((kc) => [kc.kcId, kc.bktParams || {}])
    ),
    hintDependencies: (step.hints || []).map((hint) => ({
      hintId: hint.id,
      index: hint.index,
      dependsOn: hint.dependsOn || [],
      rawDependencyIds: hint.rawDependencyIds || []
    }))
  };
}

export async function buildTeacherContext({
  lessonId,
  problemId,
  stepIndex = 0,
  studentProgress = {}
}) {
  const numericStepIndex = Number(stepIndex);
  const lessonTemplate = await getLessonById(lessonId);
  const problem = await getProblemById(lessonId, problemId);
  const step = await getStepByIndex(lessonId, problemId, numericStepIndex);

  return {
    teacherContext: {
      courseName: lessonTemplate.course?.courseName || problem.courseName || "",
      lessonLabel: lessonTemplate.lesson?.lessonLabel || problem.lessonLabel || "",
      problemTitle: problem.title || "",
      problemBody: problem.body || "",
      currentStep: {
        id: step.id,
        index: step.index,
        stepTitle: step.stepTitle || "",
        stepBody: step.stepBody || "",
        answerType: step.answerType || "",
        availableHints: (step.hints || []).map((hint) => ({
          index: hint.index,
          text: hint.text || ""
        })),
        knowledgeComponents: (step.knowledgeComponents || []).map((kc) => kc.kcId)
      },
      studentProgress: normalizeStudentProgress(numericStepIndex, studentProgress)
    },
    debug: buildDebugMetadata(step)
  };
}
