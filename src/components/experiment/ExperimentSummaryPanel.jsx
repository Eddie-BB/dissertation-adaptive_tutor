"use client";

export default function ExperimentSummaryPanel({ condition, lessonPlan, result, student }) {
  const status = result?.status || "idle";
  const totalTurns = new Set(result?.transcript?.map((message) => message.turn) || []).size;

  return (
    <section className="panel summaryPanel" aria-labelledby="experiment-summary-title">
      <div className="panelHeader">
        <div>
          <p className="fieldLabel">Run status</p>
          <h2 id="experiment-summary-title">Experiment summary</h2>
        </div>
        <span className={`statusPill ${status}`}>{status}</span>
      </div>

      <dl className="summaryList">
        <div>
          <dt>Condition</dt>
          <dd>{condition?.label || "Not selected"}</dd>
        </div>
        <div>
          <dt>Lesson plan</dt>
          <dd>{lessonPlan?.label || "Not selected"}</dd>
        </div>
        <div>
          <dt>Total turns</dt>
          <dd>{totalTurns || 0}</dd>
        </div>
        <div>
          <dt>Run ID</dt>
          <dd>{result?.runId || "Pending"}</dd>
        </div>
        <div>
          <dt>Student ID</dt>
          <dd>
            {result?.config?.student?.student_id ||
              result?.config?.studentId ||
              student?.student_id ||
              "Not generated"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
