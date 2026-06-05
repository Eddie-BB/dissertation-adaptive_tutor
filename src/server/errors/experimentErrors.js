const ERROR_DEFINITIONS = {
  INVALID_REQUEST_BODY: {
    status: 400,
    message: "Request body could not be processed.",
    recoverable: true
  },
  STUDENT_ID_MISSING: {
    status: 400,
    message: "Generate a student profile before starting the experiment.",
    recoverable: true
  },
  STUDENT_ID_INVALID: {
    status: 400,
    message: "Student ID is invalid. Generate or select a valid student before starting the experiment.",
    recoverable: true
  },
  STUDENT_PROFILE_NOT_FOUND: {
    status: 404,
    message: "Student profile not found. Generate or select a student before starting the experiment.",
    recoverable: true
  },
  STUDENT_PROFILE_INVALID: {
    status: 400,
    message: "Student profile could not be loaded. Generate a new student profile.",
    recoverable: true
  },
  LESSON_FILE_NOT_FOUND: {
    status: 500,
    message: "Lesson file could not be loaded.",
    recoverable: false
  },
  LESSON_FILE_INVALID: {
    status: 500,
    message: "Lesson file could not be loaded.",
    recoverable: false
  },
  LESSON_INVALID: {
    status: 500,
    message: "The selected lesson is invalid or incomplete.",
    recoverable: false
  },
  CONDITION_INVALID: {
    status: 400,
    message: "Selected condition is not valid for this lesson.",
    recoverable: true
  },
  MODEL_ADAPTER_UNAVAILABLE: {
    status: 503,
    message: "The model adapter is unavailable. Check your environment settings or use the mock runner.",
    recoverable: true
  },
  STUDENT_RESPONSE_INVALID: {
    status: 502,
    message: "The student response could not be processed.",
    recoverable: true
  },
  TUTOR_RESPONSE_INVALID: {
    status: 502,
    message: "The tutor response could not be processed.",
    recoverable: true
  },
  VALIDATION_FAILED: {
    status: 500,
    message: "Validation failed for this response. Check the lesson answer format.",
    recoverable: false
  },
  EMPTY_EXPERIMENT_RUN: {
    status: 500,
    message: "The experiment did not produce a transcript. Try running it again.",
    recoverable: true
  },
  EXPERIMENT_RUN_FAILED: {
    status: 500,
    message: "The experiment failed. Check the configuration and try again.",
    recoverable: true
  },
  STUDENT_GENERATION_FAILED: {
    status: 500,
    message: "Student profile could not be generated. Check the configuration and try again.",
    recoverable: true
  }
};

export class ExperimentError extends Error {
  constructor(errorCode, options = {}) {
    const definition = ERROR_DEFINITIONS[errorCode] || ERROR_DEFINITIONS.EXPERIMENT_RUN_FAILED;
    super(options.message || definition.message);
    this.name = "ExperimentError";
    this.errorCode = errorCode in ERROR_DEFINITIONS ? errorCode : "EXPERIMENT_RUN_FAILED";
    this.status = options.status || definition.status;
    this.recoverable = options.recoverable ?? definition.recoverable;
    this.cause = options.cause;
    this.safeDetails = options.safeDetails || null;
  }
}

export function createExperimentError(errorCode, options = {}) {
  return new ExperimentError(errorCode, options);
}

export function isExperimentError(error) {
  return error instanceof ExperimentError;
}

function inferErrorCode(error) {
  const message = String(error?.message || "");

  if (error?.code === "ENOENT") {
    return "LESSON_FILE_NOT_FOUND";
  }
  if (message.includes("OPENAI_API_KEY is not configured") || message.includes("adapter unavailable")) {
    return "MODEL_ADAPTER_UNAVAILABLE";
  }
  if (message.includes("Teacher message") || message.includes("teacher text generation")) {
    return "TUTOR_RESPONSE_INVALID";
  }
  if (message.includes("BehaviouralEmission") || message.includes("student text")) {
    return "STUDENT_RESPONSE_INVALID";
  }
  if (message.includes("Validation")) {
    return "VALIDATION_FAILED";
  }

  return "EXPERIMENT_RUN_FAILED";
}

export function normalizeExperimentError(error, fallbackCode = "EXPERIMENT_RUN_FAILED") {
  if (isExperimentError(error)) {
    return error;
  }

  const inferredCode = inferErrorCode(error);
  const errorCode = inferredCode === "EXPERIMENT_RUN_FAILED" ? fallbackCode : inferredCode;
  return createExperimentError(errorCode, { cause: error });
}

export function toErrorResponse(error, fallbackCode = "EXPERIMENT_RUN_FAILED") {
  const normalized = normalizeExperimentError(error, fallbackCode);

  return {
    status: normalized.status,
    body: {
      ok: false,
      errorCode: normalized.errorCode,
      message: normalized.message,
      recoverable: normalized.recoverable,
      details: normalized.safeDetails || undefined
    }
  };
}

export function getSafeErrorMessage(error, fallbackCode = "EXPERIMENT_RUN_FAILED") {
  return normalizeExperimentError(error, fallbackCode).message;
}

export { ERROR_DEFINITIONS };
