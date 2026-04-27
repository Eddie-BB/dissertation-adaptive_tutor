import { readFile } from "node:fs/promises";
import path from "node:path";

const CONTENT_DIR = path.join(process.cwd(), "content", "oatutor_lesson_templates");
const INDEX_FILE = "index.json";

let cachedIndex;
const cachedLessons = new Map();

class ContentLookupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ContentLookupError";
    this.status = status;
  }
}

async function readJsonFile(fileName) {
  const filePath = path.join(CONTENT_DIR, fileName);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function assertSafeFileName(fileName) {
  if (!fileName || path.basename(fileName) !== fileName || fileName.includes("..")) {
    throw new ContentLookupError(`Invalid lesson file name: ${fileName}`, 400);
  }
}

function findIndexEntryByLessonId(index, lessonId) {
  return index.lessons.find((lesson) => lesson.lessonId === lessonId);
}

export async function getLessonIndex() {
  if (!cachedIndex) {
    cachedIndex = await readJsonFile(INDEX_FILE);
  }

  return cachedIndex;
}

export async function getLessonById(lessonId) {
  if (!lessonId) {
    throw new ContentLookupError("lessonId is required", 400);
  }

  const index = await getLessonIndex();
  const entry = findIndexEntryByLessonId(index, lessonId);

  if (!entry) {
    throw new ContentLookupError(`Unknown lessonId: ${lessonId}`, 404);
  }

  return getLessonByFile(entry.file);
}

export async function getLessonByFile(fileName) {
  assertSafeFileName(fileName);

  const index = await getLessonIndex();
  const entry = index.lessons.find((lesson) => lesson.file === fileName);

  if (!entry) {
    throw new ContentLookupError(`Lesson file is not in the lesson index: ${fileName}`, 404);
  }

  if (!cachedLessons.has(fileName)) {
    cachedLessons.set(fileName, await readJsonFile(fileName));
  }

  return cachedLessons.get(fileName);
}

export async function getProblemById(lessonId, problemId) {
  if (!problemId) {
    throw new ContentLookupError("problemId is required", 400);
  }

  const lesson = await getLessonById(lessonId);
  const problem = lesson.problems?.find((item) => item.id === problemId);

  if (!problem) {
    throw new ContentLookupError(`Unknown problemId for lesson ${lessonId}: ${problemId}`, 404);
  }

  return problem;
}

export async function getStepByIndex(lessonId, problemId, stepIndex) {
  const numericStepIndex = Number(stepIndex);

  if (!Number.isInteger(numericStepIndex) || numericStepIndex < 0) {
    throw new ContentLookupError(`Invalid stepIndex: ${stepIndex}`, 400);
  }

  const problem = await getProblemById(lessonId, problemId);
  const step = problem.steps?.find((item) => item.index === numericStepIndex);

  if (!step) {
    throw new ContentLookupError(
      `Unknown stepIndex for problem ${problemId}: ${numericStepIndex}`,
      404
    );
  }

  return step;
}

export function isContentLookupError(error) {
  return error instanceof ContentLookupError;
}
