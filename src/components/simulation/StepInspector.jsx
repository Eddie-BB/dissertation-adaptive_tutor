"use client";

import MathText from "./MathText";

export default function StepInspector({ problem, selectedStepIndex, onSelectStep }) {
  const steps = problem?.steps || [];
  const step = steps.find((item) => item.index === selectedStepIndex) || steps[0];

  return (
    <section className="panel detailPanel">
      <div className="panelHeader splitHeader">
        <h2>Step Inspector</h2>
        {steps.length > 0 ? (
          <select
            aria-label="Select step"
            onChange={(event) => onSelectStep(Number(event.target.value))}
            value={step?.index ?? 0}
          >
            {steps.map((item) => (
              <option key={item.id} value={item.index}>
                Step {item.index + 1}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {step ? (
        <div className="contentStack">
          <div>
            <p className="fieldLabel">Title</p>
            <MathText
              as="p"
              className="bodyText"
              text={step.stepTitle || "Untitled step"}
            />
          </div>
          {step.stepBody ? (
            <div>
              <p className="fieldLabel">Body</p>
              <MathText as="p" className="bodyText" text={step.stepBody} />
            </div>
          ) : null}
          <div className="tagRow">
            <span>{step.problemType}</span>
            <span>{step.answerType}</span>
            <span>{step.validation?.mode || "no validation mode"}</span>
          </div>
          <div>
            <p className="fieldLabel">Hints</p>
            <ol className="hintList">
              {(step.hints || []).map((hint) => (
                <li key={hint.id}>
                  <MathText text={hint.text} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <p className="mutedText">Select a problem to inspect its steps.</p>
      )}
    </section>
  );
}
