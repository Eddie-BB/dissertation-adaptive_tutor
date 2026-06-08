"use client";

function downloadMarkdown(markdown, fileName) {
  if (!markdown) {
    return;
  }

  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName || "experiment-report.md";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ExperimentConfigPanel({
  batchError,
  batchResult,
  batchStatus,
  config,
  disabled,
  experimentRunning,
  experimentStatus,
  lessonPlans,
  onChange,
  onReset,
  onStart,
  onStartBatch,
  student,
  conditions
}) {
  const batchRuns = Math.min(Math.max(Number(config.batchRuns) || 1, 1), 30);
  const batchRunning = batchStatus === "running";
  const activeStatus = batchStatus !== "idle" ? batchStatus : experimentStatus || "idle";
  const batchArtifacts = batchResult?.artifacts || null;
  const completedBatchRuns = batchResult?.completedRuns ?? 0;
  const failedBatchRuns = batchResult?.failedRuns ?? 0;
  const totalBatchRuns = batchResult?.totalRuns ?? batchRuns;
  const currentBatchRun = batchResult?.currentRun || null;
  const runReports = [...(batchArtifacts?.runs || [])].sort((left, right) => left.runIndex - right.runIndex);
  const summaryReport = batchArtifacts?.summary || null;

  function updateField(field, value) {
    onChange({
      ...config,
      [field]: value
    });
  }

  return (
    <section className="panel configPanel" aria-labelledby="experiment-config-title">
      <div className="panelHeader">
        <div>
          <div className="titleStatusRow">
            <p className="fieldLabel">Experiment setup</p>
            <span className={`statusPill ${activeStatus}`}>{activeStatus}</span>
          </div>
          <h2 id="experiment-config-title">Run configuration</h2>
        </div>
      </div>

      <div className="controlStack">
        <label className="fieldControl">
          <span>Conditions</span>
          <select
            aria-label="Condition"
            disabled={disabled || conditions.length === 0}
            onChange={(event) => updateField("conditionId", event.target.value)}
            value={config.conditionId}
          >
            {conditions.map((condition) => (
              <option key={condition.id} value={condition.id}>
                {condition.label}
              </option>
            ))}
          </select>
        </label>
        {conditions.find((condition) => condition.id === config.conditionId)?.description ? (
          <p className="helpText">
            {conditions.find((condition) => condition.id === config.conditionId).description}
          </p>
        ) : null}

        <label className="fieldControl">
          <span>Lesson plan or problem set</span>
          <select
            disabled={disabled || lessonPlans.length === 0}
            onChange={(event) => updateField("lessonPlanId", event.target.value)}
            value={config.lessonPlanId}
          >
            {lessonPlans.map((lessonPlan) => (
              <option key={lessonPlan.id} value={lessonPlan.id}>
                {lessonPlan.label}
              </option>
            ))}
          </select>
        </label>
        {lessonPlans.find((lessonPlan) => lessonPlan.id === config.lessonPlanId)?.description ? (
          <p className="helpText">
            {lessonPlans.find((lessonPlan) => lessonPlan.id === config.lessonPlanId).description}
          </p>
        ) : null}

        <div className="settingsGrid">
          <label className="fieldControl">
            <span>Seed</span>
            <input
              disabled={disabled}
              min="0"
              onChange={(event) => updateField("seed", Number(event.target.value))}
              type="number"
              value={config.seed}
            />
          </label>
          <label className="fieldControl">
            <span>Number of turns</span>
            <input
              disabled={disabled}
              max="30"
              min="1"
              onChange={(event) => updateField("maxTurns", Number(event.target.value))}
              type="number"
              value={config.maxTurns}
            />
          </label>
        </div>

        <div className="batchOptions">
          <label className="fieldControl">
            <span>Number of runs</span>
            <input
              disabled={disabled}
              max="30"
              min="1"
              onChange={(event) => updateField("batchRuns", Number(event.target.value))}
              type="number"
              value={config.batchRuns}
            />
          </label>
        </div>
      </div>

      <div className="runControls">
        <button
          className="primaryButton"
          disabled={disabled || !config.conditionId || !config.lessonPlanId || !student?.student_id}
          onClick={onStart}
          type="button"
        >
          {experimentRunning ? "Running experiment" : "Start experiment"}
        </button>
        <button
          className="primaryButton"
          disabled={disabled || !config.conditionId || !config.lessonPlanId || batchRuns < 1}
          onClick={onStartBatch}
          type="button"
        >
          {batchRunning ? `Running ${batchRuns} runs` : "Start batch"}
        </button>
        <button className="secondaryButton" disabled={disabled} onClick={onReset} type="button">
          Reset experiment
        </button>
      </div>
      {batchRunning ? (
        <div className="batchRunningNotice" role="status" aria-live="polite">
          <strong>Batch running</strong>
          <span>
            {completedBatchRuns} complete, {failedBatchRuns} failed, {totalBatchRuns} queued.
          </span>
          {currentBatchRun ? (
            <span>
              Running {currentBatchRun.runIndex} of {totalBatchRuns}: {currentBatchRun.conditionId} seed{" "}
              {currentBatchRun.seed}
            </span>
          ) : null}
        </div>
      ) : null}
      {batchError ? (
        <p className="errorText" role="alert">
          {batchError}
        </p>
      ) : null}
      {batchResult ? (
        <dl className="summaryList batchSummaryList">
          <div>
            <dt>Batch completed</dt>
            <dd>
              {completedBatchRuns} of {totalBatchRuns}
            </dd>
          </div>
          <div>
            <dt>Failed</dt>
            <dd>{failedBatchRuns}</dd>
          </div>
          <div>
            <dt>Output folder</dt>
            <dd>{batchResult.outputDir || "Pending"}</dd>
          </div>
          <div>
            <dt>Manifest</dt>
            <dd>{batchResult.manifestPath || "Pending"}</dd>
          </div>
        </dl>
      ) : null}
      {batchArtifacts ? (
        <div className="batchReports">
          <h3>Batch Markdown reports</h3>
          <button
            className="secondaryButton exportButton"
            onClick={() =>
              downloadMarkdown(
                summaryReport?.markdown,
                summaryReport?.markdownFileName
              )
            }
            disabled={!summaryReport?.markdown}
            type="button"
          >
            {summaryReport?.markdown ? "Download batch summary" : "Batch summary pending"}
          </button>
          <div className="reportList">
            {runReports.map((run) => (
              <button
                className="secondaryButton reportButton"
                key={run.runId}
                onClick={() => downloadMarkdown(run.markdown, run.markdownFileName)}
                disabled={!run.markdown}
                type="button"
              >
                {run.runIndex}. {run.conditionId} seed {run.seed}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {!student?.student_id ? (
        <p className="helpText">Generate a student profile before starting the experiment.</p>
      ) : (
        <p className="helpText">Experiment will use generated student {student.student_id}.</p>
      )}
    </section>
  );
}
