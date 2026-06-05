import { readFile } from "node:fs/promises";
import path from "node:path";
import { createExperimentError } from "../errors/experimentErrors.js";

const CONTENT_DIR = path.join(process.cwd(), "content", "lessons");
const ACTIVE_LESSON_FILE = "systems_linear_equations_two_variables.json";

let cachedActiveLesson;

async function readJsonFile(fileName) {
  const filePath = path.join(CONTENT_DIR, fileName);
  let raw;

  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw createExperimentError("LESSON_FILE_NOT_FOUND", { cause: error });
    }

    throw createExperimentError("LESSON_FILE_INVALID", { cause: error });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw createExperimentError("LESSON_FILE_INVALID", { cause: error });
  }
}

export function validateLessonStructure(lesson) {
  const problems = Array.isArray(lesson?.problems) ? lesson.problems : [];
  const steps = problems.flatMap((problem) => (Array.isArray(problem?.steps) ? problem.steps : []));

  if (!lesson?.lesson?.lessonId || !lesson?.lesson?.lessonLabel || steps.length === 0) {
    throw createExperimentError("LESSON_INVALID");
  }

  const invalidStep = steps.find(
    (step) => !step?.id || !step?.stepTitle || !Array.isArray(step?.expectedAnswers)
  );

  if (invalidStep) {
    throw createExperimentError("LESSON_INVALID");
  }

  return lesson;
}

export async function getActiveLesson() {
  if (!cachedActiveLesson) {
    cachedActiveLesson = validateLessonStructure(await readJsonFile(ACTIVE_LESSON_FILE));
  }

  return cachedActiveLesson;
}

export function clearActiveLessonCacheForTests() {
  cachedActiveLesson = null;
}
