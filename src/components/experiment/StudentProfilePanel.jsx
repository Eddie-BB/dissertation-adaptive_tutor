"use client";

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4) : "n/a";
}

export default function StudentProfilePanel({
  disabled,
  error,
  onGenerate,
  onValidateLoop,
  student,
  validation
}) {
  const profile = student?.student_profile || {};
  const factors = student?.factor_definitions || [];
  const currentState = student?.current_state || {};
  const constants = student?.appraisal_constants || currentState.appraisal_constants || {};
  const lastArmOutput = student?.last_arm_output || null;
  const lastBehaviouralOutput = student?.last_behavioural_output || null;
  const debugLog = student?.last_debug_log || null;

  return (
    <section className="panel studentPanel" aria-labelledby="student-profile-title">
      <div className="panelHeader">
        <div>
          <p className="fieldLabel">Learner model</p>
          <h2 id="student-profile-title">Generated student</h2>
        </div>
        <span className="runnerBadge">ARM profile</span>
      </div>

      <div className="studentActions">
        <button className="primaryButton" disabled={disabled} onClick={onGenerate} type="button">
          Generate student
        </button>
        <button
          className="secondaryButton"
          disabled={disabled || !student?.student_id}
          onClick={onValidateLoop}
          type="button"
        >
          Validate appraisal loop
        </button>
      </div>

      {error ? (
        <p className="errorText" role="alert">
          {error}
        </p>
      ) : null}

      {student ? (
        <div className="studentProfileStack">
          <dl className="summaryList compactSummary">
            <div>
              <dt>Student ID</dt>
              <dd>{student.student_id}</dd>
            </div>
            <div>
              <dt>Stored at</dt>
              <dd>{student.storage?.filePath || "Pending"}</dd>
            </div>
          </dl>

          <details className="factorDropdown">
            <summary>Variation factors</summary>
            <div className="factorGrid">
              {factors.map((factor) => (
                <div className="factorItem" key={factor.key}>
                  <strong>{factor.label}</strong>
                  <span>{formatNumber(profile[factor.key])}</span>
                  <p>{factor.description}</p>
                </div>
              ))}
            </div>
          </details>

          <div>
            <p className="fieldLabel">Current appraisal input state</p>
            <dl className="armGrid">
              <div>
                <dt>A_prev</dt>
                <dd>{formatNumber(currentState.A_prev)}</dd>
              </div>
              <div>
                <dt>reward_trace_prev</dt>
                <dd>{formatNumber(currentState.reward_trace_prev)}</dd>
              </div>
            </dl>
          </div>

          <div>
            <p className="fieldLabel">ARM constants</p>
            <dl className="armGrid">
              <div>
                <dt>dt</dt>
                <dd>{formatNumber(constants.dt)}</dd>
              </div>
              <div>
                <dt>s</dt>
                <dd>{formatNumber(constants.s)}</dd>
              </div>
              <div>
                <dt>a</dt>
                <dd>{formatNumber(constants.a)}</dd>
              </div>
              <div>
                <dt>kM_max</dt>
                <dd>{formatNumber(constants.kM_max)}</dd>
              </div>
            </dl>
          </div>

          {lastArmOutput ? (
            <div>
              <p className="fieldLabel">Last ARM output</p>
              <dl className="armGrid">
                <div>
                  <dt>M_t</dt>
                  <dd>{formatNumber(lastArmOutput.M_t)}</dd>
                </div>
                <div>
                  <dt>R_t</dt>
                  <dd>{formatNumber(lastArmOutput.R_t)}</dd>
                </div>
                <div>
                  <dt>A_t</dt>
                  <dd>{formatNumber(lastArmOutput.A_t)}</dd>
                </div>
                <div>
                  <dt>reward_trace_t</dt>
                  <dd>{formatNumber(lastArmOutput.reward_trace_t)}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {lastBehaviouralOutput ? (
            <div>
              <p className="fieldLabel">Last behavioural output</p>
              <dl className="summaryList compactSummary">
                <div>
                  <dt>Selected behaviour</dt>
                  <dd>{lastBehaviouralOutput.selected_behaviour || "n/a"}</dd>
                </div>
                <div>
                  <dt>Student text</dt>
                  <dd>{lastBehaviouralOutput.student_text || "n/a"}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {validation ? (
            <div>
              <p className="fieldLabel">Loop validation</p>
              <dl className="armGrid">
                <div>
                  <dt>A_t {"->"} A_prev</dt>
                  <dd>{validation.A_t_to_next_A_prev ? "valid" : "invalid"}</dd>
                </div>
                <div>
                  <dt>reward trace</dt>
                  <dd>{validation.reward_trace_t_to_next_reward_trace_prev ? "valid" : "invalid"}</dd>
                </div>
                <div>
                  <dt>profile</dt>
                  <dd>{validation.profile_preserved ? "valid" : "invalid"}</dd>
                </div>
                <div>
                  <dt>constants</dt>
                  <dd>{validation.constants_preserved ? "valid" : "invalid"}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {debugLog ? (
            <div>
              <p className="fieldLabel">Experimenter debug log</p>
              <p className="errorText" role="alert">
                The student response could not be processed.
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="helpText">
          Generate a student before running ARM experiments. The profile file stores stable
          sensitivities and the mutable state used by appraisal on each turn.
        </p>
      )}
    </section>
  );
}
