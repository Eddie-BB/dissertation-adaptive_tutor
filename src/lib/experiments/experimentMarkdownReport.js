function formatValue(value) {
  if (value == null || value === "") {
    return "n/a";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(4).replace(/\.?0+$/, "") : "n/a";
  }
  return String(value);
}

function formatArm(arm = {}) {
  return `A ${formatValue(arm.A_t)} | R ${formatValue(arm.R_t)} | M ${formatValue(arm.M_t)}`;
}

function markdownValue(value) {
  return String(formatValue(value)).replace(/\|/g, "\\|");
}

function stripMathDelimiters(value) {
  return String(value || "")
    .replace(/\$\$([^$]+)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\\\((.*?)\\\)/g, "$1")
    .replace(/\\\[(.*?)\\\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownText(value) {
  return stripMathDelimiters(String(value || "n/a")).replace(/\r?\n/g, " ").trim();
}

function markdownList(values = []) {
  const entries = Array.isArray(values) ? values : [values];
  const cleaned = entries.map((value) => markdownText(value)).filter((value) => value && value !== "n/a");

  return cleaned.length > 0 ? cleaned.join("; ") : "n/a";
}

function distributionToMarkdown(title, distribution = {}, total = 0) {
  const entries = Object.entries(distribution);
  if (entries.length === 0) {
    return [`## ${title}`, "", "No data recorded.", ""].join("\n");
  }

  return [
    `## ${title}`,
    "",
    "| # | Item | Count | Percentage |",
    "| ---: | --- | ---: | ---: |",
    ...entries.map(([label, count], index) => {
      const percentage = total > 0 ? `${((Number(count) / total) * 100).toFixed(1)}%` : "0%";
      return `| ${index + 1} | ${markdownValue(label)} | ${markdownValue(count)} | ${percentage} |`;
    }),
    ""
  ].join("\n");
}

function componentScoresToMarkdown(componentScores = {}) {
  const entries = Object.entries(componentScores || {});
  if (entries.length === 0) {
    return ["No ARM component scoring recorded."];
  }

  return [
    "| Component | Value | Brief computation explanation |",
    "| --- | ---: | --- |",
    ...entries.map(([key, payload]) =>
      `| ${markdownValue(key)} | ${markdownValue(payload?.value)} | ${markdownValue(payload?.reason || "No rationale recorded.")} |`
    )
  ];
}

function keyValueTable(title, entries = []) {
  const visibleEntries = entries.filter(([_key, value]) => {
    if (value == null || value === "") return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Math.abs(value) > 0;
    return true;
  });

  if (visibleEntries.length === 0) {
    return [];
  }

  return [
    "",
    `${title}:`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...visibleEntries.map(([key, value]) => `| ${markdownValue(key)} | ${markdownValue(value)} |`)
  ];
}

function actionChoiceLines(turn) {
  const actionChoice = turn.tutor?.actionChoice;
  if (!actionChoice) {
    return [];
  }

  const candidates = Array.isArray(actionChoice.consideredActions)
    ? actionChoice.consideredActions
    : [];
  const sortedCandidates = candidates
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 5);

  return [
    "",
    "Teacher action choice:",
    "",
    `- Selected action score: ${markdownValue(actionChoice.selectedScore)}`,
    ...(sortedCandidates.length > 0
      ? [
          "",
          "| Candidate action | Score | Rationale |",
          "| --- | ---: | --- |",
          ...sortedCandidates.map((candidate) =>
            `| ${markdownValue(candidate.action)} | ${markdownValue(candidate.score)} | ${markdownValue(candidate.rationale)} |`
          )
        ]
      : [])
  ];
}

function teacherValidationLines(turn) {
  return [
    "",
    "Teacher validation correctness:",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Correct | ${turn.validation?.isCorrect ? "yes" : "no"} |`,
    `| Validation category | ${markdownValue(turn.validation?.category)} |`,
    `| Incorrect attempts on current step | ${markdownValue(turn.validation?.incorrectAttemptCount ?? 0)} |`,
    `| Submitted answer | ${markdownValue(turn.validation?.submittedAnswer || turn.student?.structuredAnswer || "none")} |`,
    `| Normalized student answer | ${markdownValue(turn.validation?.normalizedStudentAnswer)} |`,
    `| Expected answer | ${markdownValue(turn.validation?.normalizedExpectedAnswer || markdownList(turn.validation?.expectedAnswers))} |`,
    `| Accepted answers | ${markdownValue(markdownList(turn.validation?.acceptedAnswers))} |`,
    `| Validation mode | ${markdownValue(turn.validation?.validationMode)} |`,
    `| Answer type | ${markdownValue(turn.validation?.answerType)} |`,
    `| Validation input source | ${markdownValue(turn.validation?.validationInputSource)} |`,
    `| Method / confidence | ${markdownValue(`${formatValue(turn.validation?.method)} / ${formatValue(turn.validation?.confidence)}`)} |`
  ];
}

function studentGeneratedCorrectnessLines(turn) {
  const generated = turn.student?.generatedCorrectness;
  if (!generated) {
    return [];
  }

  return [
    "",
    "Student simulator generated answer outcome:",
    "",
    "_Hidden simulator calibration; this is not visible to the teacher policy._",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Intended answer outcome | ${markdownValue(generated.intendedAnswerOutcome)} |`,
    `| Generated probability correct | ${markdownValue(generated.pCorrect)} |`,
    `| Behaviour prior correctness | ${markdownValue(generated.baseCorrectness)} |`,
    `| Correctness sampling value | ${markdownValue(generated.sample)} |`,
    `| Formula | ${markdownValue(generated.formula)} |`,
    `| Calibration rationale | ${markdownValue(generated.rationale)} |`
  ];
}

function tutorCueStateLines(turn) {
  if (!turn.tutor?.showCueStateEstimates) {
    return [];
  }

  const lines = [];
  const cueEntries = Object.entries(turn.tutor?.cues || {}).filter(([_key, value]) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Math.abs(value) > 0;
    return Boolean(value);
  });

  if (cueEntries.length > 0) {
    lines.push("", "Teacher observable cues:", "", "| Cue | Value |", "| --- | --- |");
    cueEntries.forEach(([key, value]) => {
      lines.push(`| ${markdownValue(key)} | ${markdownValue(value)} |`);
    });
  }

  lines.push(
    ...keyValueTable("Teacher internal policy signals", Object.entries(turn.tutor?.policySignals || {}))
  );

  lines.push(...actionChoiceLines(turn));

  if (turn.tutor?.estimatedArm) {
    lines.push(
      "",
      "Teacher state-aware ARM estimate:",
      "",
      `- Estimated ARM: ${markdownText(formatArm(turn.tutor.estimatedArm))}`,
      `- Estimate minus actual ARM: ${turn.tutor?.estimateVsActualArm ? markdownText(formatArm(turn.tutor.estimateVsActualArm)) : "n/a"}`
    );
  }

  return lines;
}

export function buildExperimentMarkdown(output) {
  const metadata = output.runMetadata || {};
  const metrics = output.summaryMetrics || {};
  const traits = Array.isArray(metadata.studentProfileTraits)
    ? metadata.studentProfileTraits
    : [];
  const turns = Array.isArray(output.turnSummaries) ? output.turnSummaries : [];
  const totalTurns = metadata.turnsCompleted ?? turns.length;
  const lesson = output.lesson || {};

  return [
    "# Experimenter Session Report",
    "",
    "## Run Information",
    "",
    `- Run ID: ${markdownText(metadata.runId)}`,
    `- Condition: ${markdownText(metadata.condition)}`,
    `- Turns completed: ${markdownValue(metadata.turnsCompleted ?? 0)}`,
    `- Student ID: ${markdownText(metadata.studentId)}`,
    `- Profile generation seed: ${markdownText(metadata.profileGenerationSeed)}`,
    `- Behaviour sampling seed: ${markdownText(metadata.behaviourSamplingSeed)}`,
    "",
    "### Seed Use",
    "",
    markdownText(metadata.seedExplanation),
    "",
    "### Student Profile Traits",
    "",
    traits.length > 0
      ? [
          "| Trait | Value | Description |",
          "| --- | ---: | --- |",
          ...traits.map((trait) =>
            `| ${markdownValue(trait.label || trait.key)} | ${markdownValue(trait.value)} | ${markdownValue(trait.description)} |`
          )
        ].join("\n")
      : "No variable traits recorded.",
    "",
    "## Final Session Results",
    "",
    `- Total correct responses: ${markdownValue(metrics.totalCorrectResponses ?? 0)}`,
    `- Total incorrect responses: ${markdownValue(metrics.totalIncorrectResponses ?? 0)}`,
    `- Problems completed: ${markdownValue(metrics.completedProblems ?? 0)} of ${markdownValue(lesson.problemCount ?? 0)}`,
    `- Lesson steps completed: ${markdownValue(metrics.completedSteps ?? 0)} of ${markdownValue(lesson.stepCount ?? 0)}`,
    `- Attention decline rate (attention / turn): ${markdownValue(metrics.attentionDeclineRate)}`,
    `- Monotony decline rate (monotony / turn): ${markdownValue(metrics.monotonyDeclineRate)}`,
    `- Reward decline rate (reward / turn): ${markdownValue(metrics.rewardDeclineRate)}`,
    "",
    distributionToMarkdown("Tutor Actions", metrics.tutorActionDistribution, totalTurns),
    distributionToMarkdown("Student Actions", metrics.studentActionDistribution, totalTurns),
    distributionToMarkdown("Behavioural States", metrics.hiddenBehaviourDistribution, totalTurns),
    "## Per-Turn Transcript And Experiment Log",
    "",
    ...turns.flatMap((turn) => {
      const armComputation = turn.student?.armComputation || {};
      return [
        `### Turn ${turn.turn}`,
        "",
        `- Lesson step: ${markdownText(turn.lessonStep?.stepTitle || turn.lessonStep?.stepId)}`,
        `- Step ID: ${markdownText(turn.lessonStep?.stepId)}`,
        "",
        "Teacher:",
        "",
        `- Action: ${markdownText(turn.tutor?.action)}`,
        ...(turn.tutor?.rationale ? [`- Action explanation: ${markdownText(turn.tutor.rationale)}`] : []),
        ...tutorCueStateLines(turn),
        `- Transcript: ${markdownText(turn.tutor?.text)}`,
        ...teacherValidationLines(turn),
        "",
        "Student:",
        "",
        `- Student ARM: ${markdownText(formatArm(turn.student?.arm))}`,
        `- Student ARM change: ${markdownText(formatArm(turn.student?.armChangeFromPreviousTurn))}`,
        `- Behavioural state: ${markdownText(turn.student?.behaviourState)}`,
        `- Action: ${markdownText(turn.student?.action)}`,
        `- Transcript: ${markdownText(turn.student?.text)}`,
        `- Structured answer: ${markdownText(turn.student?.structuredAnswer || "none")}`,
        ...studentGeneratedCorrectnessLines(turn),
        "",
        "ARM component scoring:",
        "",
        ...componentScoresToMarkdown(armComputation.componentScores),
        "",
        `- Aggregate M_t: ${markdownValue(armComputation.aggregates?.M_t)}`,
        `- Aggregate R_t: ${markdownValue(armComputation.aggregates?.R_t)}`,
        `- Attention update: reward trace ${markdownValue(armComputation.intermediateValues?.reward_trace_t)}, monotony sensitivity ${markdownValue(armComputation.intermediateValues?.kM_t)}, effective decline ${markdownValue(armComputation.intermediateValues?.beta_effective_t)}, resulting A_t ${markdownValue(armComputation.intermediateValues?.A_t)}`,
        ""
      ];
    })
  ].join("\n");
}

export function markdownFileNameForRun(runId) {
  const safeRunId = String(runId || "experiment-session")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .slice(0, 120);

  return `${safeRunId || "experiment-session"}.md`;
}
