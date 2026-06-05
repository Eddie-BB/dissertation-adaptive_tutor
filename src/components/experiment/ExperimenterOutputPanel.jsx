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
  return String(value || "n/a").replace(/\r?\n/g, " ").trim();
}

function distributionToMarkdown(title, distribution = {}) {
  const entries = Object.entries(distribution);
  if (entries.length === 0) {
    return [`## ${title}`, "", "No data recorded.", ""].join("\n");
  }

  return [
    `## ${title}`,
    "",
    "| Item | Count |",
    "| --- | ---: |",
    ...entries.map(([label, count]) => `| ${markdownValue(label)} | ${markdownValue(count)} |`),
    ""
  ].join("\n");
}

function buildExperimentMarkdown(output) {
  const metrics = output.summaryMetrics || {};
  const traits = Array.isArray(metadata.studentProfileTraits)
    ? metadata.studentProfileTraits
    : [];
  const turns = Array.isArray(output.turnSummaries) ? output.turnSummaries : [];

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
    `- Attention decline rate: ${markdownValue(metrics.attentionDeclineRate)}`,
    "",
    distributionToMarkdown("Tutor Action Distribution", metrics.tutorActionDistribution),
    distributionToMarkdown("Student Action Distribution", metrics.studentActionDistribution),
    distributionToMarkdown("Student State Distribution", metrics.studentStateDistribution),
    distributionToMarkdown("Behaviour State Distribution", metrics.hiddenBehaviourDistribution),
    "## Per-Turn Transcript And Experiment Log",
    "",
    ...turns.flatMap((turn) => [
      `### Turn ${turn.turn}`,
      "",
      `- Lesson step: ${markdownText(turn.lessonStep?.stepTitle || turn.lessonStep?.stepId)}`,
      `- Step ID: ${markdownText(turn.lessonStep?.stepId)}`,
      `- Tutor action: ${markdownText(turn.tutor?.action)}`,
      `- Tutor rationale: ${markdownText(turn.tutor?.rationale)}`,
      `- Tutor estimated ARM: ${
        turn.tutor?.estimatedArm ? markdownText(formatArm(turn.tutor.estimatedArm)) : "not available"
      }`,
      `- Estimate minus actual ARM: ${
        turn.tutor?.estimateVsActualArm
          ? markdownText(formatArm(turn.tutor.estimateVsActualArm))
          : "not available"
      }`,
      `- Tutor text: ${markdownText(turn.tutor?.text)}`,
      `- Student action: ${markdownText(turn.student?.action)}`,
      `- Student behaviour state: ${markdownText(turn.student?.behaviourState)}`,
      `- Student ARM: ${markdownText(formatArm(turn.student?.arm))}`,
      `- Student ARM change: ${markdownText(formatArm(turn.student?.armChangeFromPreviousTurn))}`,
      `- Student text: ${markdownText(turn.student?.text)}`,
      `- Structured answer: ${markdownText(turn.student?.structuredAnswer || "none")}`,
      `- Validation result: ${turn.validation?.isCorrect ? "correct" : markdownText(turn.validation?.category)}`,
      `- Validation method/confidence: ${markdownText(turn.validation?.method)} / ${markdownText(turn.validation?.confidence)}`,
      `- Incorrect attempt count: ${markdownValue(turn.validation?.incorrectAttemptCount ?? 0)}`,
      "",
      "| Active tutor cue | Value |",
      "| --- | --- |",
      ...Object.entries(turn.tutor?.cues || {})
        .filter(([_key, value]) => {
          if (typeof value === "boolean") {
            return value;
          }
          if (typeof value === "number") {
            return Math.abs(value) > 0;
          }
          return Boolean(value);
        })
        .map(([key, value]) => `| ${markdownValue(key)} | ${markdownValue(value)} |`),
      ""
    ])
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

function formatCueValue(value) {
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (typeof value === "number") {
    return formatValue(value);
  }
  return formatValue(value);
}

function DistributionList({ distribution }) {
  const entries = Object.entries(distribution || {});

  if (entries.length === 0) {
    return <p className="helpText">No data recorded.</p>;
  }

  return (
    <dl className="distributionList">
      {entries.map(([label, count]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{count}</dd>
        </div>
      ))}
    </dl>
  );
}

function CueList({ cues }) {
  const cueEntries = Object.entries(cues || {}).filter(([_key, value]) => {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return Math.abs(value) > 0;
    }
    return Boolean(value);
  });

  if (cueEntries.length === 0) {
    return <span className="mutedInline">No active cues</span>;
  }

  return (
    <div className="chipRow">
      {cueEntries.map(([key, value]) => (
        <span className="cueChip" key={key}>
          {key}: {formatCueValue(value)}
        </span>
      ))}
    </div>
  );
}

function TurnSummary({ turn }) {
  const correctnessClass = turn.validation.isCorrect ? "correct" : "incorrect";

  return (
    <article className="turnSummaryCard">
      <div className="turnSummaryHeader">
        <div>
          <p className="fieldLabel">Turn {turn.turn}</p>
          <h3>{turn.lessonStep.stepTitle || turn.lessonStep.stepId}</h3>
          <p className="mutedText">{turn.lessonStep.stepId}</p>
        </div>
        <span className={`resultChip ${correctnessClass}`}>
          {turn.validation.isCorrect ? "correct" : turn.validation.category}
        </span>
      </div>

      <div className="turnFlowGrid">
        <section>
          <p className="fieldLabel">Tutor cue/state estimate</p>
          <CueList cues={turn.tutor.cues} />
          <dl className="compactMetricList">
            <div>
              <dt>Estimated ARM</dt>
              <dd>{turn.tutor.estimatedArm ? formatArm(turn.tutor.estimatedArm) : "not available"}</dd>
            </div>
            <div>
              <dt>Estimate - actual</dt>
              <dd>
                {turn.tutor.estimateVsActualArm
                  ? formatArm(turn.tutor.estimateVsActualArm)
                  : "not available"}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <p className="fieldLabel">Tutor action</p>
          <p className="actionText">{turn.tutor.action || "n/a"}</p>
          <p className="bodyText">{turn.tutor.text}</p>
          {turn.tutor.rationale ? <p className="rationaleText">{turn.tutor.rationale}</p> : null}
        </section>

        <section>
          <p className="fieldLabel">Student response and validation</p>
          <p className="bodyText">{turn.student.text}</p>
          <dl className="compactMetricList">
            <div>
              <dt>Student action</dt>
              <dd>{turn.student.action || "n/a"}</dd>
            </div>
            <div>
              <dt>Structured answer</dt>
              <dd>{turn.student.structuredAnswer || "none"}</dd>
            </div>
            <div>
              <dt>Incorrect attempts</dt>
              <dd>{turn.validation.incorrectAttemptCount}</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>
                {turn.validation.method || "n/a"} / {turn.validation.confidence || "n/a"}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <p className="fieldLabel">Student ARM/state change</p>
          <dl className="compactMetricList">
            <div>
              <dt>Actual ARM</dt>
              <dd>{formatArm(turn.student.arm)}</dd>
            </div>
            <div>
              <dt>Change from previous</dt>
              <dd>{formatArm(turn.student.armChangeFromPreviousTurn)}</dd>
            </div>
            <div>
              <dt>Behaviour state</dt>
              <dd>{turn.student.behaviourState || "n/a"}</dd>
            </div>
          </dl>
        </section>
      </div>
    </article>
  );
}

export default function ExperimenterOutputPanel({ output, status }) {
  if (status !== "complete" || !output) {
    return null;
  }

  const metrics = output.summaryMetrics || {};

  return (
    <section className="panel experimenterOutputPanel" aria-labelledby="experimenter-output-title">
      <div className="panelHeader outputHeader">
        <div>
          <p className="fieldLabel">Post-session output</p>
          <h2 id="experimenter-output-title">Experimenter log</h2>
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

      <div className="outputSection">
        <h3>Final session results</h3>
        <div className="metricCards">
          <div>
            <span>Total correct</span>
            <strong>{metrics.totalCorrectResponses ?? 0}</strong>
          </div>
          <div>
            <span>Total incorrect</span>
            <strong>{metrics.totalIncorrectResponses ?? 0}</strong>
          </div>
          <div>
            <span>Attention decline rate</span>
            <strong>{formatValue(metrics.attentionDeclineRate)}</strong>
          </div>
        </div>

        <div className="distributionGrid">
          <section>
            <h4>Tutor actions</h4>
            <DistributionList distribution={metrics.tutorActionDistribution} />
          </section>
          <section>
            <h4>Student actions</h4>
            <DistributionList distribution={metrics.studentActionDistribution} />
          </section>
          <section>
            <h4>Student states</h4>
            <DistributionList distribution={metrics.studentStateDistribution} />
          </section>
          <section>
            <h4>Behaviour states</h4>
            <DistributionList distribution={metrics.hiddenBehaviourDistribution} />
          </section>
        </div>
      </div>

      <div className="outputSection">
        <h3>Per-turn transcript and log</h3>
        <div className="turnSummaryStack">
          {(output.turnSummaries || []).map((turn) => (
            <TurnSummary key={turn.turn} turn={turn} />
          ))}
        </div>
      </div>
    </section>
  );
}
