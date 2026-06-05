"use client";

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

function markdownText(value) {
  return stripMathDelimiters(String(value || "n/a")).replace(/\r?\n/g, " ").trim();
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

function tutorCueStateLines(turn) {
  if (!turn.tutor?.showCueStateEstimates) {
    return [];
  }

  const lines = ["", "Teacher cue/state estimates:", ""];
  const cueEntries = Object.entries(turn.tutor?.cues || {}).filter(([_key, value]) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Math.abs(value) > 0;
    return Boolean(value);
  });

  if (cueEntries.length > 0) {
    lines.push("| Cue | Value |", "| --- | --- |");
    cueEntries.forEach(([key, value]) => {
      lines.push(`| ${markdownValue(key)} | ${markdownValue(value)} |`);
    });
  }

  if (turn.tutor?.estimatedArm) {
    lines.push(
      "",
      `- Estimated ARM: ${markdownText(formatArm(turn.tutor.estimatedArm))}`,
      `- Estimate minus actual ARM: ${turn.tutor?.estimateVsActualArm ? markdownText(formatArm(turn.tutor.estimateVsActualArm)) : "n/a"}`
    );
  }

  return lines;
}

function buildExperimentMarkdown(output) {
  const metadata = output.runMetadata || {};
  const metrics = output.summaryMetrics || {};
  const traits = Array.isArray(metadata.studentProfileTraits)
    ? metadata.studentProfileTraits
    : [];
  const turns = Array.isArray(output.turnSummaries) ? output.turnSummaries : [];
  const totalTurns = metadata.turnsCompleted ?? turns.length;

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
      `- Validation: ${turn.validation?.isCorrect ? "correct" : "incorrect"}; incorrect count: ${markdownValue(turn.validation?.incorrectAttemptCount ?? 0)}`,
      `- Action: ${markdownText(turn.tutor?.action)}`,
      ...(turn.tutor?.rationale ? [`- Action explanation: ${markdownText(turn.tutor.rationale)}`] : []),
      ...tutorCueStateLines(turn),
      `- Transcript: ${markdownText(turn.tutor?.text)}`,
      "",
      "Student:",
      "",
      `- Student ARM: ${markdownText(formatArm(turn.student?.arm))}`,
      `- Student ARM change: ${markdownText(formatArm(turn.student?.armChangeFromPreviousTurn))}`,
      `- Behavioural state: ${markdownText(turn.student?.behaviourState)}`,
      `- Action: ${markdownText(turn.student?.action)}`,
      `- Transcript: ${markdownText(turn.student?.text)}`,
      `- Structured answer: ${markdownText(turn.student?.structuredAnswer || "none")}`,
      `- Validation method/confidence: ${markdownText(turn.validation?.method)} / ${markdownText(turn.validation?.confidence)}`,
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

function downloadMarkdown(output) {
  const markdown = buildExperimentMarkdown(output);
  const runId = output?.runMetadata?.runId || "experiment-session";
  const safeRunId = String(runId).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 120);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${safeRunId || "experiment-session"}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ExperimenterOutputPanel({ output, status }) {
  if (status !== "complete" || !output) {
    return null;
  }

  return (
    <section className="panel experimenterOutputPanel" aria-labelledby="experimenter-output-title">
      <div className="panelHeader outputHeader">
        <div>
          <p className="fieldLabel">Post-session output</p>
          <h2 id="experimenter-output-title">Download final report</h2>
        </div>
        <div className="outputActions">
          <button
            className="secondaryButton exportButton"
            onClick={() => downloadMarkdown(output)}
            type="button"
          >
            Download Markdown
          </button>
          <span className="statusPill complete">complete</span>
        </div>
      </div>
      <p className="helpText">
        The complete final results, transcript, validation outcomes, ARM values, and condition-appropriate cue/state estimates are exported as a Markdown document.
      </p>
    </section>
  );
}
