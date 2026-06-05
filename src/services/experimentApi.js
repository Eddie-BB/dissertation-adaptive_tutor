async function readJsonResponse(response, fallbackMessage) {
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new Error(fallbackMessage);
  }

  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.message || fallbackMessage);
    error.errorCode = data?.errorCode || null;
    error.recoverable = Boolean(data?.recoverable);
    throw error;
  }

  return data;
}

export async function getAvailableConditions() {
  const response = await fetch("/api/experiments/conditions");
  const data = await readJsonResponse(response, "Unable to load conditions");

  return data.conditions || [];
}

export async function getAvailableLessonPlans() {
  const response = await fetch("/api/content/lesson");
  const lesson = await readJsonResponse(response, "Unable to load lesson plan");

  const steps = (lesson.problems || []).flatMap((problem) => problem.steps || []);

  return [
    {
      id: lesson.lesson?.lessonId || "",
      label: lesson.lesson?.lessonLabel || "Active lesson",
      description: `${lesson.course?.courseName || ""} | ${
        lesson.problems?.length || 0
      } problems | ${steps.length} steps`
    }
  ];
}

export async function runExperiment(config) {
  const response = await fetch("/api/experiments/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(config)
  });

  return readJsonResponse(response, "Unable to run experiment");
}

export async function generateStudentProfile(config) {
  const response = await fetch("/api/students/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      seed: config.seed,
      conditionId: config.conditionId
    })
  });

  const data = await readJsonResponse(response, "Unable to generate student profile");
  return data.student;
}

export async function validateStudentAppraisalLoop({ studentId }) {
  const response = await fetch("/api/students/validate-appraisal-loop", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      studentId
    })
  });

  return readJsonResponse(response, "Unable to validate student appraisal loop");
}
