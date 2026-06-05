"use client";

export default function ExperimentConfigPanel({
  config,
  disabled,
  lessonPlans,
  onChange,
  onReset,
  onStart,
  student,
  conditions
}) {
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
          <p className="fieldLabel">Experiment setup</p>
          <h2 id="experiment-config-title">Run configuration</h2>
        </div>
        <span className="runnerBadge">Local mock runner</span>
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
      </div>

      <div className="runControls">
        <button
          className="primaryButton"
          disabled={disabled || !config.conditionId || !config.lessonPlanId || !student?.student_id}
          onClick={onStart}
          type="button"
        >
          {disabled ? "Running experiment" : "Start experiment"}
        </button>
        <button className="secondaryButton" disabled={disabled} onClick={onReset} type="button">
          Reset experiment
        </button>
      </div>
      {!student?.student_id ? (
        <p className="helpText">Generate a student profile before starting the experiment.</p>
      ) : (
        <p className="helpText">Experiment will use generated student {student.student_id}.</p>
      )}
    </section>
  );
}
