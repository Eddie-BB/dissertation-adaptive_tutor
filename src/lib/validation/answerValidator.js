const CATEGORY_TO_FEEDBACK_TYPE = {
  correct: "confirm",
  partially_correct: "targeted_hint",
  misconception: "correct_misconception",
  incorrect: "reteach",
  unknown: "ask_clarifying_question"
};

const DEFAULT_FEEDBACK = {
  correct: "Correct. Move on to the next step.",
  partiallyCorrect: "You have part of the idea. Add the missing concept and try again.",
  misconception: "That answer matches a common misconception. Recheck the definition before retrying.",
  incorrect: "That does not match the lesson answer. Review the worked step and try an easier version.",
  unknown: "I cannot confidently classify that answer. Please clarify your reasoning."
};

function asArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function stripMathDelimiters(value) {
  return String(value ?? "").replace(/\$\$/g, "").trim();
}

export function normalizeAnswerText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\$\$/g, "")
    .replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, "$1/$2")
    .replace(/[^\p{L}\p{N}/.+\-=\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMathText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\$\$/g, " ")
    .replace(/\\\(|\\\)|\\\[|\\\]/g, " ")
    .replace(/−/g, "-")
    .replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, "$1/$2")
    .replace(/\s+/g, " ")
    .trim();
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);

  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }

  return x || 1;
}

function decimalToFraction(value) {
  const text = String(value);
  if (!text.includes(".")) {
    return { numerator: Number(text), denominator: 1 };
  }

  const sign = text.trim().startsWith("-") ? -1 : 1;
  const unsigned = text.replace(/^[+-]/, "");
  const [whole, fractional = ""] = unsigned.split(".");
  const denominator = 10 ** fractional.length;
  const numerator = sign * (Number(whole || 0) * denominator + Number(fractional || 0));
  const divisor = gcd(numerator, denominator);

  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor
  };
}

function simplifyFraction({ numerator, denominator }) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  const sign = denominator < 0 ? -1 : 1;
  const adjustedNumerator = numerator * sign;
  const adjustedDenominator = Math.abs(denominator);

  if (Number.isInteger(adjustedNumerator) && Number.isInteger(adjustedDenominator)) {
    const divisor = gcd(adjustedNumerator, adjustedDenominator);
    return {
      numerator: adjustedNumerator / divisor,
      denominator: adjustedDenominator / divisor
    };
  }

  return {
    numerator: adjustedNumerator,
    denominator: adjustedDenominator
  };
}

function formatArithmeticAnswer(value) {
  if (!value) {
    return "";
  }

  if (Number.isInteger(value.numerator) && Number.isInteger(value.denominator)) {
    return value.denominator === 1
      ? String(value.numerator)
      : `${value.numerator}/${value.denominator}`;
  }

  return String(Number(value.numeric.toFixed(10)));
}

function parseArithmeticToken(token) {
  const normalized = normalizeMathText(token).replace(/\s*\/\s*/g, "/");
  const fractionMatch = normalized.match(/^([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)$/);

  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    const simplified = simplifyFraction({ numerator, denominator });
    if (!simplified) {
      return null;
    }

    return {
      ...simplified,
      numeric: simplified.numerator / simplified.denominator,
      source: normalized
    };
  }

  if (/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    const fraction = simplifyFraction(decimalToFraction(normalized));
    return {
      ...fraction,
      numeric: Number(normalized),
      source: normalized
    };
  }

  return null;
}

function extractArithmeticToken(rawAnswer) {
  const text = normalizeMathText(rawAnswer);
  if (!text) {
    return null;
  }

  const tokenPattern = "[+-]?\\d+(?:\\.\\d+)?\\s*\\/\\s*[+-]?\\d+(?:\\.\\d+)?|[+-]?\\d+(?:\\.\\d+)?";
  const markerPattern = new RegExp(
    `(?:final\\s+answer|answer|result|equals|equal\\s+to|is|=)\\s*(?:is|:|=)?\\s*(${tokenPattern})`,
    "gi"
  );
  const marked = Array.from(text.matchAll(markerPattern)).map((match) => match[1]);
  if (marked.length > 0) {
    return marked[marked.length - 1];
  }

  const exact = text.match(new RegExp(`^\\s*(${tokenPattern})\\s*$`, "i"));
  if (exact) {
    return exact[1];
  }

  const candidates = Array.from(text.matchAll(new RegExp(tokenPattern, "gi"))).map((match) => match[0]);
  return candidates.length === 1 ? candidates[0] : null;
}

function parseArithmeticAnswer(rawAnswer) {
  const token = extractArithmeticToken(rawAnswer);
  if (!token) {
    return null;
  }

  return parseArithmeticToken(token);
}

function arithmeticEquivalent(studentAnswer, expectedAnswer, tolerance = 1e-6) {
  const parsedStudent = parseArithmeticAnswer(studentAnswer);
  const parsedExpected = parseArithmeticAnswer(expectedAnswer);

  if (!parsedStudent || !parsedExpected) {
    return null;
  }

  const difference = Math.abs(parsedStudent.numeric - parsedExpected.numeric);
  return {
    isEquivalent: difference <= tolerance,
    normalisedStudentAnswer: formatArithmeticAnswer(parsedStudent),
    normalisedExpectedAnswer: formatArithmeticAnswer(parsedExpected),
    numericDifference: Number(difference.toPrecision(6))
  };
}

function getSkillIds(questionSpec) {
  return [
    ...asArray(questionSpec.skillIds),
    ...asArray(questionSpec.learningObjectiveIds),
    ...asArray(questionSpec.knowledgeComponents).map((kc) => kc.kcId).filter(Boolean)
  ].filter(Boolean);
}

function inferRequiredConcepts(questionSpec, expectedAnswers) {
  if (questionSpec.requiredConcepts?.length > 0 || questionSpec.validation?.requiredConcepts?.length > 0) {
    return [
      ...asArray(questionSpec.requiredConcepts),
      ...asArray(questionSpec.validation?.requiredConcepts)
    ];
  }

  return expectedAnswers.map(stripMathDelimiters).filter(Boolean);
}

function inferChoiceMisconceptions(questionSpec, acceptedAnswers) {
  const acceptedSet = new Set(acceptedAnswers.map(normalizeAnswerText));

  return asArray(questionSpec.choices)
    .filter((choice) => !acceptedSet.has(normalizeAnswerText(choice)))
    .map((choice) => ({
      id: `choice_distractor_${normalizeAnswerText(choice).replace(/[^a-z0-9]+/g, "_")}`,
      description: `Selected distractor choice: ${choice}`,
      patterns: [choice],
      feedback: questionSpec.feedback?.misconception || DEFAULT_FEEDBACK.misconception
    }));
}

function inferFeedback(questionSpec, validation) {
  const feedback = questionSpec.feedback || validation.feedback || {};
  const firstHint = asArray(questionSpec.hints).find((hint) => hint.text || hint.title);

  return {
    correct: feedback.correct || DEFAULT_FEEDBACK.correct,
    partiallyCorrect:
      feedback.partiallyCorrect || firstHint?.text || firstHint?.title || DEFAULT_FEEDBACK.partiallyCorrect,
    misconception: feedback.misconception || DEFAULT_FEEDBACK.misconception,
    incorrect: feedback.incorrect || firstHint?.text || firstHint?.title || DEFAULT_FEEDBACK.incorrect,
    unknown: feedback.unknown || DEFAULT_FEEDBACK.unknown
  };
}

function normalizeQuestionSpec(input) {
  const questionSpec = input.questionSpec || input.question || input.step || {};
  const validation = questionSpec.validation || {};
  const expectedAnswers = [
    ...asArray(questionSpec.expectedAnswer),
    ...asArray(questionSpec.expectedAnswers)
  ];
  const acceptedAnswers = unique([
    ...expectedAnswers,
    ...asArray(questionSpec.acceptedAnswers),
    ...asArray(validation.acceptedAnswers)
  ]);
  const feedback = inferFeedback(questionSpec, validation);
  const misconceptions = [
    ...asArray(questionSpec.misconceptions),
    ...asArray(questionSpec.commonMisconceptions),
    ...asArray(validation.misconceptions),
    ...asArray(validation.commonMisconceptions)
  ];

  return {
    id: input.questionId || questionSpec.id || questionSpec.simulationStepId || "",
    lessonId: input.lessonId || "",
    prompt: questionSpec.prompt || questionSpec.stepTitle || questionSpec.title || "",
    expectedAnswers,
    acceptedAnswers,
    answerPatterns: [
      ...asArray(questionSpec.answerPatterns),
      ...asArray(validation.answerPatterns)
    ],
    requiredConcepts: inferRequiredConcepts(questionSpec, expectedAnswers),
    misconceptions: [
      ...misconceptions,
      ...inferChoiceMisconceptions(questionSpec, acceptedAnswers)
    ],
    skillIds: getSkillIds(questionSpec),
    difficulty: questionSpec.difficulty || validation.difficulty || null,
    validationMode: validation.mode || questionSpec.validationMode || null,
    answerType: questionSpec.answerType || validation.answerType || null,
    tolerance: validation.tolerance ?? questionSpec.tolerance ?? 1e-6,
    feedback
  };
}

function stringMatchesPattern(answer, pattern) {
  const normalizedPattern = normalizeAnswerText(pattern);

  if (!normalizedPattern) {
    return false;
  }

  if (answer === normalizedPattern) {
    return true;
  }

  const escapedPattern = normalizedPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapedPattern}([^\\p{L}\\p{N}]|$)`, "u").test(
    answer
  );
}

function regexMatchesPattern(rawAnswer, pattern) {
  if (typeof pattern !== "string" || !pattern.startsWith("/") || pattern.lastIndexOf("/") <= 0) {
    return false;
  }

  const finalSlashIndex = pattern.lastIndexOf("/");
  const body = pattern.slice(1, finalSlashIndex);
  const flags = pattern.slice(finalSlashIndex + 1) || "i";

  try {
    return new RegExp(body, flags).test(rawAnswer);
  } catch {
    return false;
  }
}

function matchesAny(rawAnswer, normalizedAnswer, patterns) {
  return patterns.find((pattern) => {
    if (regexMatchesPattern(rawAnswer, pattern)) {
      return true;
    }

    return stringMatchesPattern(normalizedAnswer, pattern);
  });
}

function findMatchedMisconception(rawAnswer, normalizedAnswer, misconceptions) {
  return misconceptions.find((misconception) =>
    matchesAny(rawAnswer, normalizedAnswer, asArray(misconception.patterns))
  );
}

function findMissingConcepts(normalizedAnswer, requiredConcepts) {
  return requiredConcepts.filter((concept) => !stringMatchesPattern(normalizedAnswer, concept));
}

function buildFeedbackMessage(category, questionSpec, missingConcepts, matchedMisconception) {
  if (category === "misconception" && matchedMisconception?.feedback) {
    return matchedMisconception.feedback;
  }

  if (category === "partially_correct" && missingConcepts.length > 0) {
    return `${questionSpec.feedback.partiallyCorrect} Missing: ${missingConcepts.join(", ")}.`;
  }

  if (category === "partially_correct") {
    return questionSpec.feedback.partiallyCorrect;
  }

  return questionSpec.feedback[category === "incorrect" ? "incorrect" : category] || DEFAULT_FEEDBACK.unknown;
}

function classifyAnswer(input, questionSpec) {
  const rawAnswer = String(input.studentAnswer ?? input.action?.input ?? "");
  const normalizedAnswer = normalizeAnswerText(rawAnswer);
  const matchedMisconception = findMatchedMisconception(
    rawAnswer,
    normalizedAnswer,
    questionSpec.misconceptions
  );

  if (!normalizedAnswer) {
    return {
      category: "unknown",
      matchedRuleId: null,
      matchedMisconception,
      missingConcepts: questionSpec.requiredConcepts
    };
  }

  if (matchedMisconception) {
    return {
      category: "misconception",
      matchedRuleId: matchedMisconception.id || null,
      matchedMisconception,
      missingConcepts: questionSpec.requiredConcepts
    };
  }

  if (questionSpec.validationMode === "arithmetic_equivalence" || questionSpec.answerType === "arithmetic") {
    const parsedStudentArithmeticAnswer = parseArithmeticAnswer(rawAnswer);
    const arithmeticMatch = questionSpec.acceptedAnswers
      .map((expectedAnswer) => arithmeticEquivalent(rawAnswer, expectedAnswer, questionSpec.tolerance))
      .find((result) => result?.isEquivalent);

    if (arithmeticMatch) {
      return {
        category: "correct",
        matchedRuleId: "arithmetic_equivalence",
        matchedMisconception: null,
        missingConcepts: [],
        method: "arithmetic_equivalence",
        normalisedStudentAnswer: arithmeticMatch.normalisedStudentAnswer,
        normalisedExpectedAnswer: arithmeticMatch.normalisedExpectedAnswer,
        numericDifference: arithmeticMatch.numericDifference
      };
    }

    if (parsedStudentArithmeticAnswer) {
      return {
        category: "incorrect",
        matchedRuleId: "arithmetic_equivalence_mismatch",
        matchedMisconception: null,
        missingConcepts: [],
        method: "arithmetic_equivalence",
        normalisedStudentAnswer: formatArithmeticAnswer(parsedStudentArithmeticAnswer),
        normalisedExpectedAnswer: null
      };
    }
  }

  const exactMatch = matchesAny(rawAnswer, normalizedAnswer, questionSpec.acceptedAnswers);
  const patternMatch = matchesAny(rawAnswer, normalizedAnswer, questionSpec.answerPatterns);

  if (exactMatch || patternMatch) {
    return {
      category: "correct",
      matchedRuleId: exactMatch || patternMatch || "accepted_answer",
      matchedMisconception: null,
      missingConcepts: []
    };
  }

  const missingConcepts = findMissingConcepts(normalizedAnswer, questionSpec.requiredConcepts);
  const conceptCount = questionSpec.requiredConcepts.length;
  const presentConceptCount = conceptCount - missingConcepts.length;

  if (conceptCount > 0 && presentConceptCount === conceptCount) {
    return {
      category: "correct",
      matchedRuleId: "required_concepts",
      matchedMisconception: null,
      missingConcepts: []
    };
  }

  if (conceptCount > 0 && presentConceptCount > 0) {
    return {
      category: "partially_correct",
      matchedRuleId: "concept_coverage",
      matchedMisconception: null,
      missingConcepts
    };
  }

  if (rawAnswer.trim().length <= 3) {
    return {
      category: "unknown",
      matchedRuleId: null,
      matchedMisconception: null,
      missingConcepts
    };
  }

  return {
    category: "incorrect",
    matchedRuleId: null,
    matchedMisconception: null,
    missingConcepts
  };
}

function getScore(category) {
  if (category === "correct") {
    return 2;
  }

  if (category === "partially_correct") {
    return 1;
  }

  return 0;
}

function getConfidence(category, matchedRuleId) {
  if (category === "unknown") {
    return "low";
  }

  if (category === "correct" || category === "misconception" || matchedRuleId) {
    return "high";
  }

  return "medium";
}

function hasStructuredAnswer(value) {
  return String(value ?? "").trim().length > 0;
}

const NON_ANSWER_ACTIONS = new Set([
  "ask_for_help",
  "off_task",
  "no_response"
]);

function resolveValidationInput(input) {
  const studentResponse = input.studentResponse || input.student_response || {};
  const structuredAnswer =
    input.structuredAnswer ??
    input.structured_answer ??
    studentResponse.student_answer ??
    studentResponse.studentAnswer;
  const displayText =
    input.studentAnswer ??
    studentResponse.student_text ??
    studentResponse.studentText ??
    input.displayText ??
    "";
  const studentAction =
    input.studentAction ??
    input.student_action ??
    studentResponse.student_action ??
    studentResponse.studentAction ??
    "submitAnswer";

  if (hasStructuredAnswer(structuredAnswer)) {
    return {
      studentAnswer: structuredAnswer,
      displayText,
      studentAction,
      source: "structured_answer"
    };
  }

  if (NON_ANSWER_ACTIONS.has(String(studentAction))) {
    return {
      studentAnswer: "",
      displayText,
      studentAction,
      source: "non_answer_action"
    };
  }

  return {
    studentAnswer: displayText,
    displayText,
    studentAction,
    source: "display_text"
  };
}

export function createStudentAction({ questionId, studentAnswer, action = "submitAnswer" }) {
  return {
    selection: questionId,
    action,
    input: studentAnswer
  };
}

export async function validateWithRubricModel() {
  throw new Error(
    "Rubric-model validation is not configured. Use deterministic validateAnswer output as the experiment-safe default."
  );
}

export function validateAnswer(input) {
  const questionSpec = normalizeQuestionSpec(input);
  const validationInput = resolveValidationInput(input);
  const action =
    input.action ||
    createStudentAction({
      questionId: questionSpec.id,
      studentAnswer: validationInput.studentAnswer,
      action: validationInput.studentAction
    });
  const classification = classifyAnswer(
    {
      ...input,
      studentAnswer: validationInput.studentAnswer,
      action
    },
    questionSpec
  );
  const category = classification.category;
  const misconceptionIds = classification.matchedMisconception?.id
    ? [classification.matchedMisconception.id]
    : [];

  return {
    isCorrect: category === "correct",
    category,
    score: getScore(category),
    confidence: getConfidence(category, classification.matchedRuleId),
    matchedRuleId: classification.matchedRuleId,
    method: classification.method || classification.matchedRuleId || "deterministic_text",
    normalisedStudentAnswer:
      classification.normalisedStudentAnswer || normalizeAnswerText(validationInput.studentAnswer),
    normalisedExpectedAnswer: classification.normalisedExpectedAnswer || null,
    validationInputSource: validationInput.source,
    displayText: validationInput.displayText,
    studentAction: validationInput.studentAction,
    skillIds: questionSpec.skillIds,
    learningObjectiveIds: questionSpec.skillIds,
    missingConcepts: classification.missingConcepts,
    misconceptionIds,
    feedbackType: CATEGORY_TO_FEEDBACK_TYPE[category],
    feedbackMessage: buildFeedbackMessage(
      category,
      questionSpec,
      classification.missingConcepts,
      classification.matchedMisconception
    ),
    action,
    questionId: questionSpec.id,
    lessonId: questionSpec.lessonId
  };
}
